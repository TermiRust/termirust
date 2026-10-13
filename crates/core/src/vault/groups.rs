use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::items::{ItemKind, StoredItem, not_found};
use super::open::Vault;
use crate::{CoreError, Result};

/// A folder of hosts. v0.1 allows one level of nesting.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Group {
    pub name: String,
    pub parent_id: Option<Uuid>,
    #[serde(default)]
    pub sort: i32,
    /// Tab colour for hosts in this group; `None` derives one from the name.
    #[serde(default)]
    pub color: Option<String>,
    /// Draw a warning border around terminals of this group's hosts (e.g. production).
    #[serde(default)]
    pub warning_border: bool,
}

impl Group {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            parent_id: None,
            sort: 0,
            color: None,
            warning_border: false,
        }
    }
}

pub type GroupRecord = StoredItem<Group>;

pub struct GroupRepository<'a> {
    vault: &'a Vault,
}

impl Vault {
    pub fn groups(&self) -> GroupRepository<'_> {
        GroupRepository { vault: self }
    }
}

impl GroupRepository<'_> {
    pub async fn create(&self, group: &Group) -> Result<GroupRecord> {
        let group = self.validated(group, None).await?;
        let meta = self.vault.insert_item(ItemKind::Group, &group).await?;
        Ok(StoredItem {
            meta,
            payload: group,
        })
    }

    pub async fn update(&self, id: Uuid, group: &Group) -> Result<GroupRecord> {
        let group = self.validated(group, Some(id)).await?;
        let meta = self.vault.update_item(ItemKind::Group, id, &group).await?;
        Ok(StoredItem {
            meta,
            payload: group,
        })
    }

    /// Deletes the group without deleting its contents: hosts become ungrouped and
    /// subgroups move to the top level.
    pub async fn delete(&self, id: Uuid) -> Result<()> {
        self.get(id)
            .await?
            .ok_or_else(|| not_found(ItemKind::Group, id))?;

        for record in self.vault.hosts().list().await? {
            if record.payload.group_id == Some(id) {
                let mut host = record.payload;
                host.group_id = None;
                self.vault
                    .update_item(ItemKind::Host, record.meta.id, &host)
                    .await?;
            }
        }
        for record in self.list().await? {
            if record.payload.parent_id == Some(id) {
                let mut child = record.payload;
                child.parent_id = None;
                self.vault
                    .update_item(ItemKind::Group, record.meta.id, &child)
                    .await?;
            }
        }
        self.vault.delete_item(ItemKind::Group, id).await
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<GroupRecord>> {
        self.vault.get_item(ItemKind::Group, id).await
    }

    pub async fn list(&self) -> Result<Vec<GroupRecord>> {
        self.vault.list_items(ItemKind::Group).await
    }

    async fn validated(&self, group: &Group, own_id: Option<Uuid>) -> Result<Group> {
        let mut group = group.clone();
        group.name = group.name.trim().to_owned();
        if group.name.is_empty() {
            return Err(CoreError::InvalidData("group name is required".into()));
        }
        super::hosts::check_color(&group.color)?;
        if let Some(parent_id) = group.parent_id {
            if Some(parent_id) == own_id {
                return Err(CoreError::InvalidData(
                    "a group cannot contain itself".into(),
                ));
            }
            let parent = self
                .get(parent_id)
                .await?
                .ok_or_else(|| not_found(ItemKind::Group, parent_id))?;
            if parent.payload.parent_id.is_some() {
                return Err(CoreError::InvalidData(
                    "groups can be nested only one level deep".into(),
                ));
            }
            if let Some(own_id) = own_id {
                let has_children = self
                    .list()
                    .await?
                    .iter()
                    .any(|g| g.payload.parent_id == Some(own_id));
                if has_children {
                    return Err(CoreError::InvalidData(
                        "a group with subgroups cannot become a subgroup".into(),
                    ));
                }
            }
        }
        Ok(group)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use crate::vault::{Host, MemoryKeyStore};

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn creates_a_group_with_a_trimmed_name() {
        let vault = vault().await;
        let created = vault
            .groups()
            .create(&Group::new("  Production "))
            .await
            .unwrap();
        assert_eq!(created.payload.name, "Production");
        assert_eq!(vault.groups().list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn stores_colour_and_warning_border_and_rejects_unknown_colours() {
        let vault = vault().await;
        let prod = Group {
            color: Some("red".into()),
            warning_border: true,
            ..Group::new("Prod")
        };
        let saved = vault.groups().create(&prod).await.unwrap().payload;
        assert_eq!(
            (saved.color.as_deref(), saved.warning_border),
            (Some("red"), true)
        );
        let odd = Group {
            color: Some("gold".into()),
            ..Group::new("X")
        };
        assert!(matches!(
            vault.groups().create(&odd).await,
            Err(CoreError::InvalidData(_))
        ));
    }

    #[test]
    fn groups_saved_before_these_fields_existed_still_load() {
        let group: Group = serde_json::from_str(r#"{"name":"Old","parent_id":null}"#).unwrap();
        assert_eq!((group.color, group.warning_border), (None, false));
    }

    #[tokio::test]
    async fn rejects_an_empty_name() {
        let vault = vault().await;
        assert!(matches!(
            vault.groups().create(&Group::new("   ")).await,
            Err(CoreError::InvalidData(_))
        ));
    }

    #[tokio::test]
    async fn allows_one_level_of_nesting_only() {
        let vault = vault().await;
        let top = vault.groups().create(&Group::new("Prod")).await.unwrap();
        let child = vault
            .groups()
            .create(&Group {
                parent_id: Some(top.meta.id),
                ..Group::new("EU")
            })
            .await
            .unwrap();

        let grandchild = Group {
            parent_id: Some(child.meta.id),
            ..Group::new("Paris")
        };
        let err = vault.groups().create(&grandchild).await.unwrap_err();
        assert!(matches!(err, CoreError::InvalidData(m) if m.contains("one level")));
    }

    #[tokio::test]
    async fn a_parent_group_cannot_become_a_subgroup() {
        let vault = vault().await;
        let a = vault.groups().create(&Group::new("A")).await.unwrap();
        let b = vault.groups().create(&Group::new("B")).await.unwrap();
        vault
            .groups()
            .create(&Group {
                parent_id: Some(a.meta.id),
                ..Group::new("A1")
            })
            .await
            .unwrap();

        let err = vault
            .groups()
            .update(
                a.meta.id,
                &Group {
                    parent_id: Some(b.meta.id),
                    ..Group::new("A")
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::InvalidData(m) if m.contains("cannot become a subgroup")));
    }

    #[tokio::test]
    async fn a_group_cannot_be_its_own_parent() {
        let vault = vault().await;
        let a = vault.groups().create(&Group::new("A")).await.unwrap();
        let err = vault
            .groups()
            .update(
                a.meta.id,
                &Group {
                    parent_id: Some(a.meta.id),
                    ..Group::new("A")
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::InvalidData(m) if m.contains("itself")));
    }

    #[tokio::test]
    async fn parent_must_exist() {
        let vault = vault().await;
        let orphan = Group {
            parent_id: Some(Uuid::now_v7()),
            ..Group::new("X")
        };
        assert!(matches!(
            vault.groups().create(&orphan).await,
            Err(CoreError::NotFound { .. })
        ));
    }

    #[tokio::test]
    async fn deleting_a_group_keeps_its_hosts_and_subgroups() {
        let vault = vault().await;
        let group = vault.groups().create(&Group::new("Prod")).await.unwrap();
        let sub = vault
            .groups()
            .create(&Group {
                parent_id: Some(group.meta.id),
                ..Group::new("EU")
            })
            .await
            .unwrap();
        let host = vault
            .hosts()
            .create(&Host {
                group_id: Some(group.meta.id),
                ..Host::new("10.0.0.1")
            })
            .await
            .unwrap();
        let other = vault.hosts().create(&Host::new("10.0.0.2")).await.unwrap();

        vault.groups().delete(group.meta.id).await.unwrap();

        assert!(vault.groups().get(group.meta.id).await.unwrap().is_none());
        let host = vault.hosts().get(host.meta.id).await.unwrap().unwrap();
        assert_eq!(host.payload.group_id, None);
        assert_eq!(host.meta.revision, 2);
        let sub = vault.groups().get(sub.meta.id).await.unwrap().unwrap();
        assert_eq!(sub.payload.parent_id, None);
        assert_eq!(
            vault
                .hosts()
                .get(other.meta.id)
                .await
                .unwrap()
                .unwrap()
                .meta
                .revision,
            1
        );
    }

    #[tokio::test]
    async fn deleting_a_missing_group_is_not_found() {
        let vault = vault().await;
        assert!(matches!(
            vault.groups().delete(Uuid::now_v7()).await,
            Err(CoreError::NotFound { .. })
        ));
    }
}

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::items::{ItemKind, StoredItem, not_found};
use super::open::Vault;
use super::secret::Secret;
use crate::{CoreError, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum HostAuth {
    /// Ask for the password at connect time unless one is saved here.
    Password { password: Option<Secret> },
    /// Use a saved identity (username + password and/or private key).
    Identity { identity_id: Uuid },
    /// Use the keys offered by the running ssh-agent.
    Agent,
}

/// A saved SSH server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Host {
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: Option<String>,
    pub auth: HostAuth,
    pub group_id: Option<Uuid>,
    pub jump_host_id: Option<Uuid>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    pub keepalive_secs: Option<u32>,
    /// Tab colour override; `None` uses the group's colour.
    #[serde(default)]
    pub color: Option<String>,
    /// Hide AI help in this host's tabs (e.g. a production database).
    #[serde(default)]
    pub ai_disabled: bool,
}

/// Colours a host or group may use for its tabs.
pub const TAB_COLORS: &[&str] = &["red", "amber", "teal", "blue", "violet"];

pub(crate) fn check_color(color: &Option<String>) -> Result<()> {
    match color {
        Some(c) if !TAB_COLORS.contains(&c.as_str()) => {
            Err(CoreError::InvalidData(format!("unknown colour {c}")))
        }
        _ => Ok(()),
    }
}

impl Host {
    /// A host with defaults filled in: port 22, password auth, label = hostname.
    pub fn new(hostname: impl Into<String>) -> Self {
        let hostname = hostname.into();
        Self {
            label: hostname.clone(),
            hostname,
            port: 22,
            username: None,
            auth: HostAuth::Password { password: None },
            group_id: None,
            jump_host_id: None,
            tags: Vec::new(),
            notes: String::new(),
            keepalive_secs: None,
            color: None,
            ai_disabled: false,
        }
    }

    /// Trims text fields and rejects values that can never connect.
    fn normalized(&self, own_id: Option<Uuid>) -> Result<Self> {
        let mut host = self.clone();
        host.hostname = host.hostname.trim().to_owned();
        host.label = host.label.trim().to_owned();
        host.username = host
            .username
            .map(|u| u.trim().to_owned())
            .filter(|u| !u.is_empty());
        host.tags = host
            .tags
            .iter()
            .map(|t| t.trim().to_owned())
            .filter(|t| !t.is_empty())
            .fold(Vec::new(), |mut acc, t| {
                if !acc.contains(&t) {
                    acc.push(t);
                }
                acc
            });

        if host.hostname.is_empty() {
            return Err(CoreError::InvalidData("hostname is required".into()));
        }
        if host.hostname.chars().any(char::is_whitespace) {
            return Err(CoreError::InvalidData(
                "hostname must not contain spaces".into(),
            ));
        }
        if host.port == 0 {
            return Err(CoreError::InvalidData(
                "port must be between 1 and 65535".into(),
            ));
        }
        if host.label.is_empty() {
            host.label = host.hostname.clone();
        }
        check_color(&host.color)?;
        if own_id.is_some() && host.jump_host_id == own_id {
            return Err(CoreError::InvalidData(
                "a host cannot be its own jump host".into(),
            ));
        }
        Ok(host)
    }
}

pub type HostRecord = StoredItem<Host>;

pub struct HostRepository<'a> {
    vault: &'a Vault,
}

impl Vault {
    pub fn hosts(&self) -> HostRepository<'_> {
        HostRepository { vault: self }
    }
}

impl HostRepository<'_> {
    pub async fn create(&self, host: &Host) -> Result<HostRecord> {
        let host = host.normalized(None)?;
        self.check_references(&host).await?;
        let meta = self.vault.insert_item(ItemKind::Host, &host).await?;
        Ok(StoredItem {
            meta,
            payload: host,
        })
    }

    pub async fn update(&self, id: Uuid, host: &Host) -> Result<HostRecord> {
        let host = host.normalized(Some(id))?;
        self.check_references(&host).await?;
        let meta = self.vault.update_item(ItemKind::Host, id, &host).await?;
        Ok(StoredItem {
            meta,
            payload: host,
        })
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        self.vault.delete_item(ItemKind::Host, id).await?;
        self.vault.port_forwards().delete_for_host(id).await
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<HostRecord>> {
        self.vault.get_item(ItemKind::Host, id).await
    }

    pub async fn list(&self) -> Result<Vec<HostRecord>> {
        self.vault.list_items(ItemKind::Host).await
    }

    async fn check_references(&self, host: &Host) -> Result<()> {
        if let Some(group_id) = host.group_id {
            self.vault
                .get_item::<serde_json::Value>(ItemKind::Group, group_id)
                .await?
                .ok_or_else(|| not_found(ItemKind::Group, group_id))?;
        }
        if let HostAuth::Identity { identity_id } = host.auth {
            self.vault
                .get_item::<serde_json::Value>(ItemKind::Identity, identity_id)
                .await?
                .ok_or_else(|| not_found(ItemKind::Identity, identity_id))?;
        }
        if let Some(jump_id) = host.jump_host_id {
            self.get(jump_id)
                .await?
                .ok_or_else(|| not_found(ItemKind::Host, jump_id))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use crate::vault::{Group, Identity, MemoryKeyStore};

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn creates_and_reads_back_a_host() {
        let vault = vault().await;
        let mut host = Host::new("10.0.1.12");
        host.label = "prod-api-1".into();
        host.username = Some("deploy".into());
        host.auth = HostAuth::Password {
            password: Some(Secret::new("pw")),
        };

        let created = vault.hosts().create(&host).await.unwrap();
        let loaded = vault.hosts().get(created.meta.id).await.unwrap().unwrap();
        assert_eq!(loaded.payload, host);
        assert_eq!(vault.hosts().list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn normalises_whitespace_tags_and_empty_label() {
        let vault = vault().await;
        let mut host = Host::new("  example.com ");
        host.label = "  ".into();
        host.username = Some("   ".into());
        host.tags = vec![" prod ".into(), "".into(), "prod".into(), "api".into()];

        let saved = vault.hosts().create(&host).await.unwrap().payload;
        assert_eq!(saved.hostname, "example.com");
        assert_eq!(saved.label, "example.com");
        assert_eq!(saved.username, None);
        assert_eq!(saved.tags, ["prod", "api"]);
    }

    #[tokio::test]
    async fn rejects_hosts_that_can_never_connect() {
        let vault = vault().await;
        for (host, message) in [
            (Host::new("   "), "hostname is required"),
            (Host::new("my host"), "must not contain spaces"),
            (
                Host {
                    port: 0,
                    ..Host::new("h")
                },
                "port must be",
            ),
        ] {
            let err = vault.hosts().create(&host).await.unwrap_err();
            assert!(
                matches!(&err, CoreError::InvalidData(m) if m.contains(message)),
                "{err:?}"
            );
        }
    }

    #[tokio::test]
    async fn rejects_references_to_missing_groups_identities_or_jump_hosts() {
        let vault = vault().await;
        let missing = Uuid::now_v7();
        let cases = [
            Host {
                group_id: Some(missing),
                ..Host::new("h")
            },
            Host {
                auth: HostAuth::Identity {
                    identity_id: missing,
                },
                ..Host::new("h")
            },
            Host {
                jump_host_id: Some(missing),
                ..Host::new("h")
            },
        ];
        for host in cases {
            assert!(matches!(
                vault.hosts().create(&host).await,
                Err(CoreError::NotFound { .. })
            ));
        }
    }

    #[tokio::test]
    async fn accepts_existing_references() {
        let vault = vault().await;
        let group = vault
            .groups()
            .create(&Group::new("Production"))
            .await
            .unwrap();
        let identity = vault
            .identities()
            .create(&Identity::with_password("deploy", "deploy", "pw"))
            .await
            .unwrap();
        let jump = vault.hosts().create(&Host::new("bastion")).await.unwrap();

        let host = Host {
            group_id: Some(group.meta.id),
            auth: HostAuth::Identity {
                identity_id: identity.meta.id,
            },
            jump_host_id: Some(jump.meta.id),
            ..Host::new("10.0.0.5")
        };
        assert!(vault.hosts().create(&host).await.is_ok());
    }

    #[tokio::test]
    async fn a_host_cannot_jump_through_itself() {
        let vault = vault().await;
        let created = vault.hosts().create(&Host::new("h")).await.unwrap();
        let looped = Host {
            jump_host_id: Some(created.meta.id),
            ..Host::new("h")
        };
        let err = vault
            .hosts()
            .update(created.meta.id, &looped)
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::InvalidData(m) if m.contains("own jump host")));
    }

    #[tokio::test]
    async fn update_and_delete() {
        let vault = vault().await;
        let created = vault.hosts().create(&Host::new("old")).await.unwrap();
        let updated = vault
            .hosts()
            .update(created.meta.id, &Host::new("new"))
            .await
            .unwrap();
        assert_eq!(updated.meta.revision, 2);
        assert_eq!(
            vault
                .hosts()
                .get(created.meta.id)
                .await
                .unwrap()
                .unwrap()
                .payload
                .hostname,
            "new"
        );

        vault.hosts().delete(created.meta.id).await.unwrap();
        assert!(vault.hosts().list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn accepts_known_tab_colours_only() {
        let vault = vault().await;
        let blue = Host {
            color: Some("blue".into()),
            ..Host::new("h")
        };
        assert_eq!(
            vault
                .hosts()
                .create(&blue)
                .await
                .unwrap()
                .payload
                .color
                .as_deref(),
            Some("blue")
        );
        let pink = Host {
            color: Some("pink".into()),
            ..Host::new("h")
        };
        assert!(
            matches!(vault.hosts().create(&pink).await, Err(CoreError::InvalidData(m)) if m.contains("pink"))
        );
    }

    #[test]
    fn hosts_saved_before_colours_existed_still_load() {
        let json = r#"{"label":"a","hostname":"h","port":22,"username":null,"auth":{"method":"agent"},"group_id":null,"jump_host_id":null,"keepalive_secs":null}"#;
        let host: Host = serde_json::from_str(json).unwrap();
        assert_eq!(host.color, None);
    }

    #[test]
    fn password_auth_never_prints_the_password() {
        let auth = HostAuth::Password {
            password: Some(Secret::new("hunter2")),
        };
        assert!(!format!("{auth:?}").contains("hunter2"));
    }

    #[test]
    fn auth_is_stored_with_a_method_tag() {
        let json = serde_json::to_value(HostAuth::Agent).unwrap();
        assert_eq!(json, serde_json::json!({ "method": "agent" }));
    }
}

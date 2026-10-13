use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::hosts::HostAuth;
use super::items::{ItemKind, StoredItem};
use super::open::Vault;
use super::secret::Secret;
use crate::{CoreError, Result};

/// Reusable credential: a private key (shown as a Keychain key) and/or a password,
/// optionally with a default username. Hosts supply the username when this has none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Identity {
    pub label: String,
    #[serde(default)]
    pub username: Option<String>,
    pub password: Option<Secret>,
    pub private_key: Option<Secret>,
    /// Saved only when the user chose to remember it.
    pub passphrase: Option<Secret>,
    pub public_key: Option<String>,
    pub key_type: Option<String>,
    pub fingerprint: Option<String>,
}

impl Identity {
    pub fn with_password(
        label: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            label: label.into(),
            username: Some(username.into()),
            password: Some(Secret::new(password)),
            private_key: None,
            passphrase: None,
            public_key: None,
            key_type: None,
            fingerprint: None,
        }
    }

    fn normalized(&self) -> Result<Self> {
        let mut identity = self.clone();
        identity.label = identity.label.trim().to_owned();
        identity.username = identity
            .username
            .map(|u| u.trim().to_owned())
            .filter(|u| !u.is_empty());
        identity.password = identity.password.filter(|s| !s.is_empty());
        identity.private_key = identity.private_key.filter(|s| !s.is_empty());
        identity.passphrase = identity.passphrase.filter(|s| !s.is_empty());

        if identity.label.is_empty() {
            identity.label = match (&identity.username, &identity.key_type) {
                (Some(user), _) => user.clone(),
                (None, Some(kind)) => format!("{kind} key"),
                (None, None) => return Err(CoreError::InvalidData("a label is required".into())),
            };
        }
        if identity.password.is_none() && identity.private_key.is_none() {
            return Err(CoreError::InvalidData(
                "an identity needs a password or a private key".into(),
            ));
        }
        if identity.private_key.is_none() && identity.passphrase.is_some() {
            return Err(CoreError::InvalidData(
                "a passphrase needs a private key".into(),
            ));
        }
        Ok(identity)
    }
}

pub type IdentityRecord = StoredItem<Identity>;

pub struct IdentityRepository<'a> {
    vault: &'a Vault,
}

impl Vault {
    pub fn identities(&self) -> IdentityRepository<'_> {
        IdentityRepository { vault: self }
    }
}

impl IdentityRepository<'_> {
    pub async fn create(&self, identity: &Identity) -> Result<IdentityRecord> {
        let identity = identity.normalized()?;
        let meta = self
            .vault
            .insert_item(ItemKind::Identity, &identity)
            .await?;
        Ok(StoredItem {
            meta,
            payload: identity,
        })
    }

    pub async fn update(&self, id: Uuid, identity: &Identity) -> Result<IdentityRecord> {
        let identity = identity.normalized()?;
        let meta = self
            .vault
            .update_item(ItemKind::Identity, id, &identity)
            .await?;
        Ok(StoredItem {
            meta,
            payload: identity,
        })
    }

    /// Refuses while hosts still log in with this identity, so no host is left unusable.
    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let users: Vec<String> = self
            .vault
            .hosts()
            .list()
            .await?
            .into_iter()
            .filter(|h| matches!(h.payload.auth, HostAuth::Identity { identity_id } if identity_id == id))
            .map(|h| h.payload.label)
            .collect();
        if !users.is_empty() {
            return Err(CoreError::InvalidData(format!(
                "identity is used by {} host(s): {}",
                users.len(),
                users.join(", ")
            )));
        }
        self.vault.delete_item(ItemKind::Identity, id).await
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<IdentityRecord>> {
        self.vault.get_item(ItemKind::Identity, id).await
    }

    pub async fn list(&self) -> Result<Vec<IdentityRecord>> {
        self.vault.list_items(ItemKind::Identity).await
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

    fn key_identity() -> Identity {
        Identity {
            label: "deploy key".into(),
            username: Some("deploy".into()),
            password: None,
            private_key: Some(Secret::new("-----BEGIN OPENSSH PRIVATE KEY-----\n...")),
            passphrase: Some(Secret::new("pp")),
            public_key: Some("ssh-ed25519 AAAA".into()),
            key_type: Some("ed25519".into()),
            fingerprint: Some("SHA256:abc".into()),
        }
    }

    #[tokio::test]
    async fn stores_a_key_identity_and_reads_it_back() {
        let vault = vault().await;
        let created = vault.identities().create(&key_identity()).await.unwrap();
        let loaded = vault
            .identities()
            .get(created.meta.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.payload, key_identity());
    }

    #[tokio::test]
    async fn defaults_the_label_and_drops_empty_secrets() {
        let vault = vault().await;
        let mut identity = Identity::with_password("  ", " root ", "pw");
        identity.private_key = Some(Secret::new(""));
        let saved = vault.identities().create(&identity).await.unwrap().payload;
        assert_eq!(saved.label, "root");
        assert_eq!(saved.username.as_deref(), Some("root"));
        assert_eq!(saved.private_key, None);
    }

    #[tokio::test]
    async fn rejects_identities_that_cannot_log_in() {
        let vault = vault().await;
        let no_secret = Identity {
            password: None,
            private_key: None,
            passphrase: None,
            ..key_identity()
        };
        let no_label = Identity {
            label: " ".into(),
            username: None,
            key_type: None,
            ..key_identity()
        };
        let stray_passphrase = Identity {
            private_key: None,
            password: Some(Secret::new("pw")),
            ..key_identity()
        };

        for (identity, message) in [
            (no_secret, "password or a private key"),
            (no_label, "a label is required"),
            (stray_passphrase, "passphrase needs a private key"),
        ] {
            let err = vault.identities().create(&identity).await.unwrap_err();
            assert!(
                matches!(&err, CoreError::InvalidData(m) if m.contains(message)),
                "{err:?}"
            );
        }
    }

    #[tokio::test]
    async fn cannot_delete_an_identity_that_hosts_still_use() {
        let vault = vault().await;
        let identity = vault.identities().create(&key_identity()).await.unwrap();
        let host = Host {
            label: "prod-api".into(),
            auth: HostAuth::Identity {
                identity_id: identity.meta.id,
            },
            ..Host::new("10.0.0.1")
        };
        let host = vault.hosts().create(&host).await.unwrap();

        let err = vault
            .identities()
            .delete(identity.meta.id)
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::InvalidData(m) if m.contains("prod-api")));

        vault.hosts().delete(host.meta.id).await.unwrap();
        vault.identities().delete(identity.meta.id).await.unwrap();
        assert!(vault.identities().list().await.unwrap().is_empty());
    }

    #[test]
    fn debug_output_hides_every_secret() {
        let printed = format!("{:?}", key_identity());
        assert!(!printed.contains("BEGIN OPENSSH"));
        assert!(!printed.contains("\"pp\""));
        assert!(printed.contains("deploy"));
    }

    #[tokio::test]
    async fn update_replaces_the_identity() {
        let vault = vault().await;
        let created = vault.identities().create(&key_identity()).await.unwrap();
        let updated = vault
            .identities()
            .update(
                created.meta.id,
                &Identity::with_password("ops", "ops", "new"),
            )
            .await
            .unwrap();
        assert_eq!(updated.meta.revision, 2);
        assert_eq!(
            vault
                .identities()
                .get(created.meta.id)
                .await
                .unwrap()
                .unwrap()
                .payload
                .username
                .as_deref(),
            Some("ops")
        );
    }

    #[tokio::test]
    async fn a_key_without_username_or_label_is_named_after_its_type() {
        let vault = vault().await;
        let key = Identity {
            label: "".into(),
            username: None,
            ..key_identity()
        };
        let saved = vault.identities().create(&key).await.unwrap().payload;
        assert_eq!(saved.label, "ed25519 key");
        assert_eq!(saved.username, None);
    }

    #[test]
    fn identities_saved_before_username_became_optional_still_load() {
        let json = r#"{"label":"x","username":"root","password":"pw","private_key":null,"passphrase":null,"public_key":null,"key_type":null,"fingerprint":null}"#;
        let identity: Identity = serde_json::from_str(json).unwrap();
        assert_eq!(identity.username.as_deref(), Some("root"));
    }
}

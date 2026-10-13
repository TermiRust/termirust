use serde::{Deserialize, Serialize};

use super::items::{ItemKind, StoredItem};
use super::open::Vault;
use crate::Result;
use crate::ssh::HostKeyInfo;

/// A server key the user has accepted for `host:port`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub trusted_at: i64,
}

pub type KnownHostRecord = StoredItem<KnownHost>;

/// How a server's key compares with what the user trusted before.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyStatus {
    Trusted,
    Unknown,
    Changed { previous_fingerprint: String },
}

pub struct KnownHostRepository<'a> {
    vault: &'a Vault,
}

impl Vault {
    pub fn known_hosts(&self) -> KnownHostRepository<'_> {
        KnownHostRepository { vault: self }
    }
}

fn same_endpoint(record: &KnownHost, host: &str, port: u16) -> bool {
    record.port == port && record.host.eq_ignore_ascii_case(host)
}

impl KnownHostRepository<'_> {
    pub async fn find(&self, host: &str, port: u16) -> Result<Option<KnownHostRecord>> {
        Ok(self
            .vault
            .list_items::<KnownHost>(ItemKind::KnownHost)
            .await?
            .into_iter()
            .find(|r| same_endpoint(&r.payload, host, port)))
    }

    pub async fn status(&self, host: &str, port: u16, key: &HostKeyInfo) -> Result<HostKeyStatus> {
        Ok(match self.find(host, port).await? {
            None => HostKeyStatus::Unknown,
            Some(known) if known.payload.fingerprint == key.fingerprint => HostKeyStatus::Trusted,
            Some(known) => HostKeyStatus::Changed {
                previous_fingerprint: known.payload.fingerprint,
            },
        })
    }

    /// Remembers `key` for `host:port`, replacing any key trusted earlier.
    pub async fn trust(&self, host: &str, port: u16, key: &HostKeyInfo) -> Result<KnownHostRecord> {
        let known = KnownHost {
            host: host.trim().to_ascii_lowercase(),
            port,
            algorithm: key.algorithm.clone(),
            fingerprint: key.fingerprint.clone(),
            trusted_at: super::now_ms(),
        };
        let meta = match self.find(host, port).await? {
            Some(existing) => {
                self.vault
                    .update_item(ItemKind::KnownHost, existing.meta.id, &known)
                    .await?
            }
            None => self.vault.insert_item(ItemKind::KnownHost, &known).await?,
        };
        Ok(StoredItem {
            meta,
            payload: known,
        })
    }

    pub async fn list(&self) -> Result<Vec<KnownHostRecord>> {
        self.vault.list_items(ItemKind::KnownHost).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use crate::vault::MemoryKeyStore;

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    fn key(fingerprint: &str) -> HostKeyInfo {
        HostKeyInfo {
            algorithm: "ssh-ed25519".into(),
            fingerprint: fingerprint.into(),
        }
    }

    #[tokio::test]
    async fn an_unseen_server_is_unknown() {
        let vault = vault().await;
        assert_eq!(
            vault
                .known_hosts()
                .status("10.0.0.1", 22, &key("SHA256:a"))
                .await
                .unwrap(),
            HostKeyStatus::Unknown
        );
    }

    #[tokio::test]
    async fn a_trusted_key_is_recognised_case_insensitively() {
        let vault = vault().await;
        vault
            .known_hosts()
            .trust("Server.Example.com", 22, &key("SHA256:a"))
            .await
            .unwrap();
        assert_eq!(
            vault
                .known_hosts()
                .status("server.example.com", 22, &key("SHA256:a"))
                .await
                .unwrap(),
            HostKeyStatus::Trusted
        );
    }

    #[tokio::test]
    async fn the_same_host_on_another_port_is_a_different_server() {
        let vault = vault().await;
        vault
            .known_hosts()
            .trust("h", 22, &key("SHA256:a"))
            .await
            .unwrap();
        assert_eq!(
            vault
                .known_hosts()
                .status("h", 2222, &key("SHA256:a"))
                .await
                .unwrap(),
            HostKeyStatus::Unknown
        );
    }

    #[tokio::test]
    async fn a_different_key_is_reported_as_changed_with_the_old_fingerprint() {
        let vault = vault().await;
        vault
            .known_hosts()
            .trust("h", 22, &key("SHA256:old"))
            .await
            .unwrap();
        assert_eq!(
            vault
                .known_hosts()
                .status("h", 22, &key("SHA256:new"))
                .await
                .unwrap(),
            HostKeyStatus::Changed {
                previous_fingerprint: "SHA256:old".into()
            }
        );
    }

    #[tokio::test]
    async fn trusting_again_replaces_the_previous_key_instead_of_duplicating() {
        let vault = vault().await;
        vault
            .known_hosts()
            .trust("h", 22, &key("SHA256:old"))
            .await
            .unwrap();
        let replaced = vault
            .known_hosts()
            .trust("h", 22, &key("SHA256:new"))
            .await
            .unwrap();

        assert_eq!(replaced.meta.revision, 2);
        let all = vault.known_hosts().list().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].payload.fingerprint, "SHA256:new");
    }
}

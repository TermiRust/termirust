use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::items::{ItemKind, StoredItem, not_found};
use super::open::Vault;
use crate::{CoreError, Result};

pub const LOOPBACK: &str = "127.0.0.1";

/// Which way traffic flows, with the addresses on each end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ForwardSpec {
    /// `ssh -L`: listen here, connect from the server to `target`.
    Local {
        bind_host: String,
        bind_port: u16,
        target_host: String,
        target_port: u16,
    },
    /// `ssh -R`: listen on the server, connect from here to `local`. Port 0 lets the server pick.
    Remote {
        remote_host: String,
        remote_port: u16,
        local_host: String,
        local_port: u16,
    },
    /// `ssh -D`: a SOCKS5 proxy here whose connections leave from the server.
    Dynamic { bind_host: String, bind_port: u16 },
}

impl ForwardSpec {
    /// The OpenSSH flag that would do the same, e.g. "-L 127.0.0.1:5432:db:5432".
    pub fn describe(&self) -> String {
        match self {
            ForwardSpec::Local {
                bind_host,
                bind_port,
                target_host,
                target_port,
            } => format!("-L {bind_host}:{bind_port}:{target_host}:{target_port}"),
            ForwardSpec::Remote {
                remote_host,
                remote_port,
                local_host,
                local_port,
            } => format!("-R {remote_host}:{remote_port}:{local_host}:{local_port}"),
            ForwardSpec::Dynamic {
                bind_host,
                bind_port,
            } => format!("-D {bind_host}:{bind_port}"),
        }
    }
}

/// A saved port forward through one of the user's hosts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortForwardRule {
    pub label: String,
    pub host_id: Uuid,
    pub spec: ForwardSpec,
    /// Start whenever a terminal tab to the host connects.
    #[serde(default)]
    pub auto_start: bool,
}

fn address(host: &mut String, what: &str) -> Result<()> {
    *host = host.trim().to_owned();
    if host.is_empty() {
        *host = LOOPBACK.to_owned();
    }
    if host.chars().any(char::is_whitespace) {
        return Err(CoreError::InvalidData(format!(
            "{what} must not contain spaces"
        )));
    }
    Ok(())
}

fn port(value: u16, what: &str) -> Result<()> {
    if value == 0 {
        return Err(CoreError::InvalidData(format!(
            "{what} must be between 1 and 65535"
        )));
    }
    Ok(())
}

impl PortForwardRule {
    /// Empty listen addresses become 127.0.0.1 so nothing is exposed to the network by accident.
    fn normalized(&self) -> Result<Self> {
        let mut rule = self.clone();
        match &mut rule.spec {
            ForwardSpec::Local {
                bind_host,
                bind_port,
                target_host,
                target_port,
            } => {
                address(bind_host, "listen address")?;
                port(*bind_port, "listen port")?;
                *target_host = target_host.trim().to_owned();
                if target_host.is_empty() {
                    return Err(CoreError::InvalidData(
                        "destination host is required".into(),
                    ));
                }
                address(target_host, "destination host")?;
                port(*target_port, "destination port")?;
            }
            ForwardSpec::Remote {
                remote_host,
                local_host,
                local_port,
                ..
            } => {
                address(remote_host, "server listen address")?;
                address(local_host, "local destination")?;
                port(*local_port, "local destination port")?;
            }
            ForwardSpec::Dynamic {
                bind_host,
                bind_port,
            } => {
                address(bind_host, "listen address")?;
                port(*bind_port, "listen port")?;
            }
        }
        rule.label = rule.label.trim().to_owned();
        if rule.label.is_empty() {
            rule.label = rule.spec.describe();
        }
        Ok(rule)
    }
}

pub type PortForwardRecord = StoredItem<PortForwardRule>;

pub struct PortForwardRepository<'a> {
    vault: &'a Vault,
}

impl Vault {
    pub fn port_forwards(&self) -> PortForwardRepository<'_> {
        PortForwardRepository { vault: self }
    }
}

impl PortForwardRepository<'_> {
    pub async fn create(&self, rule: &PortForwardRule) -> Result<PortForwardRecord> {
        let rule = rule.normalized()?;
        self.check_host(rule.host_id).await?;
        let meta = self.vault.insert_item(ItemKind::PortForward, &rule).await?;
        Ok(StoredItem {
            meta,
            payload: rule,
        })
    }

    pub async fn update(&self, id: Uuid, rule: &PortForwardRule) -> Result<PortForwardRecord> {
        let rule = rule.normalized()?;
        self.check_host(rule.host_id).await?;
        let meta = self
            .vault
            .update_item(ItemKind::PortForward, id, &rule)
            .await?;
        Ok(StoredItem {
            meta,
            payload: rule,
        })
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        self.vault.delete_item(ItemKind::PortForward, id).await
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<PortForwardRecord>> {
        self.vault.get_item(ItemKind::PortForward, id).await
    }

    pub async fn list(&self) -> Result<Vec<PortForwardRecord>> {
        self.vault.list_items(ItemKind::PortForward).await
    }

    /// A host's forwards are meaningless without it.
    pub(crate) async fn delete_for_host(&self, host_id: Uuid) -> Result<()> {
        for record in self.list().await? {
            if record.payload.host_id == host_id {
                self.delete(record.meta.id).await?;
            }
        }
        Ok(())
    }

    async fn check_host(&self, host_id: Uuid) -> Result<()> {
        self.vault
            .get_item::<serde_json::Value>(ItemKind::Host, host_id)
            .await?
            .ok_or_else(|| not_found(ItemKind::Host, host_id))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use crate::vault::{Host, MemoryKeyStore};

    async fn vault_with_host() -> (Vault, Uuid) {
        let db = Database::open_in_memory().await.unwrap();
        let vault = Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap();
        let host = vault.hosts().create(&Host::new("bastion")).await.unwrap();
        (vault, host.meta.id)
    }

    fn local(bind_host: &str, bind_port: u16, target_host: &str) -> ForwardSpec {
        ForwardSpec::Local {
            bind_host: bind_host.into(),
            bind_port,
            target_host: target_host.into(),
            target_port: 5432,
        }
    }

    fn rule(host_id: Uuid, spec: ForwardSpec) -> PortForwardRule {
        PortForwardRule {
            label: String::new(),
            host_id,
            spec,
            auto_start: false,
        }
    }

    #[tokio::test]
    async fn stores_rules_encrypted_and_defaults_to_loopback() {
        let (vault, host_id) = vault_with_host().await;
        let saved = vault
            .port_forwards()
            .create(&rule(host_id, local("  ", 15432, " db.internal ")))
            .await
            .unwrap();
        assert_eq!(saved.payload.spec, local("127.0.0.1", 15432, "db.internal"));
        assert_eq!(saved.payload.label, "-L 127.0.0.1:15432:db.internal:5432");

        let listed = vault.port_forwards().list().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].payload, saved.payload);

        let raw: Vec<u8> =
            sqlx::query_scalar("SELECT ciphertext FROM items WHERE kind = 'port_forward'")
                .fetch_one(vault.database().pool())
                .await
                .unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("db.internal"));
    }

    #[tokio::test]
    async fn rejects_rules_that_can_never_work() {
        let (vault, host_id) = vault_with_host().await;
        let repo = vault.port_forwards();
        assert!(
            repo.create(&rule(host_id, local("", 0, "db")))
                .await
                .is_err()
        );
        assert!(repo.create(&rule(host_id, local("", 1, ""))).await.is_err());
        assert!(
            repo.create(&rule(host_id, local("0.0.0.0 x", 1, "db")))
                .await
                .is_err()
        );
        assert!(
            repo.create(&rule(Uuid::now_v7(), local("", 1, "db")))
                .await
                .is_err(),
            "the host must exist"
        );
        let remote = ForwardSpec::Remote {
            remote_host: String::new(),
            remote_port: 0,
            local_host: String::new(),
            local_port: 3000,
        };
        let saved = repo.create(&rule(host_id, remote)).await.unwrap();
        assert_eq!(
            saved.payload.spec.describe(),
            "-R 127.0.0.1:0:127.0.0.1:3000"
        );
    }

    #[tokio::test]
    async fn updates_and_deletes() {
        let (vault, host_id) = vault_with_host().await;
        let repo = vault.port_forwards();
        let saved = repo
            .create(&rule(
                host_id,
                ForwardSpec::Dynamic {
                    bind_host: String::new(),
                    bind_port: 1080,
                },
            ))
            .await
            .unwrap();
        let mut changed = saved.payload.clone();
        changed.label = "Browse as bastion".into();
        changed.auto_start = true;
        let updated = repo.update(saved.meta.id, &changed).await.unwrap();
        assert_eq!(updated.payload.label, "Browse as bastion");
        assert!(updated.payload.auto_start);

        repo.delete(saved.meta.id).await.unwrap();
        assert!(repo.get(saved.meta.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn deleting_a_host_deletes_its_forwards() {
        let (vault, host_id) = vault_with_host().await;
        let other = vault
            .hosts()
            .create(&Host::new("other"))
            .await
            .unwrap()
            .meta
            .id;
        let repo = vault.port_forwards();
        repo.create(&rule(host_id, local("", 1, "db")))
            .await
            .unwrap();
        let kept = repo.create(&rule(other, local("", 2, "db"))).await.unwrap();

        vault.hosts().delete(host_id).await.unwrap();
        let left: Vec<_> = repo
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.meta.id)
            .collect();
        assert_eq!(left, vec![kept.meta.id]);
    }
}

use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::hosts::{Host, HostAuth};
use super::identities::Identity;
use super::open::Vault;
use super::secret::Secret;
use crate::Result;
use crate::ssh::{SshConfigHost, inspect_private_key};

/// Keys `ssh` tries when a host lists no IdentityFile, in OpenSSH's order.
const DEFAULT_KEYS: &[&str] = &[".ssh/id_ed25519", ".ssh/id_ecdsa", ".ssh/id_rsa"];

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SshConfigImportSummary {
    pub created_hosts: Vec<String>,
    pub imported_keys: Vec<String>,
    /// `(alias, reason)` for every selected host that was not created.
    pub skipped: Vec<(String, String)>,
}

/// True when the vault already has a host reaching the same account on the same server.
pub async fn is_already_saved(vault: &Vault, host: &SshConfigHost) -> Result<bool> {
    let saved = vault.hosts().list().await?;
    Ok(saved.iter().any(|r| {
        r.payload.hostname.eq_ignore_ascii_case(&host.hostname)
            && r.payload.port == host.port
            && r.payload.username == host.user
    }))
}

/// Creates hosts (and the keys they use) for the chosen aliases of a parsed ssh config.
pub async fn import_ssh_config_hosts(
    vault: &Vault,
    hosts: &[SshConfigHost],
    aliases: &[String],
    home: &Path,
) -> Result<SshConfigImportSummary> {
    let mut summary = SshConfigImportSummary::default();
    let mut created: Vec<(String, Uuid, Option<String>)> = Vec::new();

    for alias in aliases {
        let Some(entry) = hosts.iter().find(|h| &h.alias == alias) else {
            summary
                .skipped
                .push((alias.clone(), "not found in the config".into()));
            continue;
        };
        if is_already_saved(vault, entry).await? {
            summary
                .skipped
                .push((alias.clone(), "already saved".into()));
            continue;
        }
        let auth = match key_for(vault, entry, home, &mut summary).await? {
            Some(identity_id) => HostAuth::Identity { identity_id },
            None => HostAuth::Agent,
        };
        let host = Host {
            label: entry.alias.clone(),
            username: entry.user.clone(),
            port: entry.port,
            auth,
            proxy_command: entry.proxy_command.clone(),
            ..Host::new(entry.hostname.clone())
        };
        match vault.hosts().create(&host).await {
            Ok(record) => {
                summary.created_hosts.push(entry.alias.clone());
                created.push((
                    entry.alias.clone(),
                    record.meta.id,
                    entry.proxy_jump.clone(),
                ));
            }
            Err(e) => summary.skipped.push((alias.clone(), e.to_string())),
        }
    }

    link_jump_hosts(vault, &created).await?;
    Ok(summary)
}

/// Second pass: a ProxyJump may name a host imported later in the same batch.
async fn link_jump_hosts(vault: &Vault, created: &[(String, Uuid, Option<String>)]) -> Result<()> {
    let all = vault.hosts().list().await?;
    for (_, id, jump) in created {
        let Some(jump) = jump else { continue };
        // Only the first hop of a "a,b" chain is kept until multi-hop jumps exist.
        let first_hop = jump
            .split(',')
            .next()
            .unwrap_or(jump)
            .split('@')
            .next_back()
            .unwrap_or(jump);
        let first_hop = first_hop.split(':').next().unwrap_or(first_hop);
        let Some(target) = all
            .iter()
            .find(|r| r.payload.label.eq_ignore_ascii_case(first_hop))
        else {
            continue;
        };
        if target.meta.id == *id {
            continue;
        }
        if let Some(record) = all.iter().find(|r| r.meta.id == *id) {
            let mut host = record.payload.clone();
            host.jump_host_id = Some(target.meta.id);
            vault.hosts().update(*id, &host).await?;
        }
    }
    Ok(())
}

/// Picks the first readable key for the host, reusing a Keychain key with the same fingerprint.
async fn key_for(
    vault: &Vault,
    entry: &SshConfigHost,
    home: &Path,
    summary: &mut SshConfigImportSummary,
) -> Result<Option<Uuid>> {
    let candidates: Vec<PathBuf> = if entry.identity_files.is_empty() {
        DEFAULT_KEYS.iter().map(|k| home.join(k)).collect()
    } else {
        entry.identity_files.clone()
    };
    for path in candidates {
        let Ok(pem) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(info) = inspect_private_key(&pem, None) else {
            continue;
        };
        let existing = vault.identities().list().await?;
        if let Some(found) = existing
            .iter()
            .find(|r| r.payload.fingerprint.as_deref() == Some(info.fingerprint.as_str()))
        {
            return Ok(Some(found.meta.id));
        }
        let label = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "imported key".into());
        let key_type = info
            .algorithm
            .strip_prefix("ssh-")
            .unwrap_or(&info.algorithm)
            .split('-')
            .next()
            .unwrap_or("")
            .to_owned();
        let identity = Identity {
            label: label.clone(),
            username: None,
            password: None,
            private_key: Some(Secret::new(pem)),
            passphrase: None,
            public_key: Some(info.public_key),
            key_type: Some(key_type),
            fingerprint: Some(info.fingerprint),
        };
        let record = vault.identities().create(&identity).await?;
        summary.imported_keys.push(label);
        return Ok(Some(record.meta.id));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::parse_ssh_config;
    use crate::storage::Database;
    use crate::vault::MemoryKeyStore;

    const ED25519: &str = include_str!("../../tests/fixtures/keys/ed25519");
    const ECDSA: &str = include_str!("../../tests/fixtures/keys/ecdsa");

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    fn home_with_keys(keys: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".ssh")).unwrap();
        for (name, pem) in keys {
            std::fs::write(dir.path().join(".ssh").join(name), pem).unwrap();
        }
        dir
    }

    fn aliases(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn imports_hosts_with_their_identity_file_as_a_keychain_key() {
        let vault = vault().await;
        let home = home_with_keys(&[("prod_key", ED25519)]);
        let config = parse_ssh_config(
            "Host prod\n  HostName 10.0.1.12\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/prod_key\n",
            home.path(),
        );

        let summary =
            import_ssh_config_hosts(&vault, &config.hosts, &aliases(&["prod"]), home.path())
                .await
                .unwrap();

        assert_eq!(summary.created_hosts, ["prod"]);
        assert_eq!(summary.imported_keys, ["prod_key"]);
        let host = &vault.hosts().list().await.unwrap()[0].payload;
        assert_eq!(
            (host.label.as_str(), host.hostname.as_str(), host.port),
            ("prod", "10.0.1.12", 2222)
        );
        assert_eq!(host.username.as_deref(), Some("deploy"));
        let HostAuth::Identity { identity_id } = host.auth else {
            panic!("expected key auth")
        };
        let key = vault
            .identities()
            .get(identity_id)
            .await
            .unwrap()
            .unwrap()
            .payload;
        assert_eq!(key.key_type.as_deref(), Some("ed25519"));
    }

    #[tokio::test]
    async fn reuses_a_key_already_in_the_keychain() {
        let vault = vault().await;
        let home = home_with_keys(&[("a", ED25519), ("b_same_key", ED25519)]);
        let config = parse_ssh_config(
            "Host one\n  IdentityFile ~/.ssh/a\nHost two\n  IdentityFile ~/.ssh/b_same_key\n",
            home.path(),
        );

        let summary = import_ssh_config_hosts(
            &vault,
            &config.hosts,
            &aliases(&["one", "two"]),
            home.path(),
        )
        .await
        .unwrap();

        assert_eq!(summary.created_hosts, ["one", "two"]);
        assert_eq!(summary.imported_keys, ["a"]);
        assert_eq!(vault.identities().list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn falls_back_to_default_keys_then_to_the_agent() {
        let vault = vault().await;
        let home = home_with_keys(&[("id_ecdsa", ECDSA)]);
        let config = parse_ssh_config("Host withdefault\n  HostName a\n", home.path());
        import_ssh_config_hosts(
            &vault,
            &config.hosts,
            &aliases(&["withdefault"]),
            home.path(),
        )
        .await
        .unwrap();
        assert!(matches!(
            vault.hosts().list().await.unwrap()[0].payload.auth,
            HostAuth::Identity { .. }
        ));

        let bare_home = home_with_keys(&[]);
        let config = parse_ssh_config(
            "Host nokeys\n  HostName b\n  IdentityFile ~/.ssh/missing\n",
            bare_home.path(),
        );
        import_ssh_config_hosts(
            &vault,
            &config.hosts,
            &aliases(&["nokeys"]),
            bare_home.path(),
        )
        .await
        .unwrap();
        let nokeys = vault
            .hosts()
            .list()
            .await
            .unwrap()
            .into_iter()
            .find(|h| h.payload.label == "nokeys")
            .unwrap();
        assert_eq!(nokeys.payload.auth, HostAuth::Agent);
    }

    #[tokio::test]
    async fn skips_hosts_already_saved_and_unknown_aliases() {
        let vault = vault().await;
        let home = home_with_keys(&[]);
        vault
            .hosts()
            .create(&Host {
                username: Some("deploy".into()),
                ..Host::new("10.0.0.1")
            })
            .await
            .unwrap();
        let config = parse_ssh_config(
            "Host dup\n  HostName 10.0.0.1\n  User deploy\n",
            home.path(),
        );

        assert!(is_already_saved(&vault, &config.hosts[0]).await.unwrap());
        let summary = import_ssh_config_hosts(
            &vault,
            &config.hosts,
            &aliases(&["dup", "ghost"]),
            home.path(),
        )
        .await
        .unwrap();

        assert!(summary.created_hosts.is_empty());
        assert_eq!(
            summary.skipped,
            [
                ("dup".into(), "already saved".into()),
                ("ghost".into(), "not found in the config".into())
            ]
        );
    }

    #[tokio::test]
    async fn links_proxy_jump_to_a_host_imported_in_the_same_batch() {
        let vault = vault().await;
        let home = home_with_keys(&[]);
        let config = parse_ssh_config(
            "Host app\n  HostName 10.0.0.2\n  ProxyJump admin@bastion:2222\nHost bastion\n  HostName 1.2.3.4\n",
            home.path(),
        );

        import_ssh_config_hosts(
            &vault,
            &config.hosts,
            &aliases(&["app", "bastion"]),
            home.path(),
        )
        .await
        .unwrap();

        let hosts = vault.hosts().list().await.unwrap();
        let bastion = hosts.iter().find(|h| h.payload.label == "bastion").unwrap();
        let app = hosts.iter().find(|h| h.payload.label == "app").unwrap();
        assert_eq!(app.payload.jump_host_id, Some(bastion.meta.id));
        assert_eq!(bastion.payload.jump_host_id, None);
    }

    #[tokio::test]
    async fn leaves_the_jump_unset_when_the_jump_host_is_not_saved() {
        let vault = vault().await;
        let home = home_with_keys(&[]);
        let config = parse_ssh_config("Host app\n  ProxyJump elsewhere\n", home.path());
        import_ssh_config_hosts(&vault, &config.hosts, &aliases(&["app"]), home.path())
            .await
            .unwrap();
        assert_eq!(
            vault.hosts().list().await.unwrap()[0].payload.jump_host_id,
            None
        );
    }
}

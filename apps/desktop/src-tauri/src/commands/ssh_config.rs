use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use termirust_core::CoreError;
use termirust_core::ssh::{SshConfigImport, read_ssh_config};
use termirust_core::vault::{import_ssh_config_hosts, is_already_saved};

use crate::command_error::CommandError;
use crate::vault_state::VaultState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigCandidate {
    pub alias: String,
    pub hostname: String,
    pub port: u16,
    pub user: Option<String>,
    pub identity_files: Vec<String>,
    pub proxy_jump: Option<String>,
    pub already_saved: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigPreview {
    pub path: String,
    pub candidates: Vec<SshConfigCandidate>,
    pub unsupported: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkippedHost {
    pub alias: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigImportResult {
    pub created_hosts: Vec<String>,
    pub imported_keys: Vec<String>,
    pub skipped: Vec<SkippedHost>,
}

fn home_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .home_dir()
        .map_err(|e| CoreError::InvalidData(format!("cannot find the home directory: {e}")).into())
}

fn config_path(path: Option<String>, home: &std::path::Path) -> PathBuf {
    path.filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".ssh").join("config"))
}

async fn candidates(
    vault: &termirust_core::vault::Vault,
    parsed: &SshConfigImport,
) -> Result<Vec<SshConfigCandidate>, CommandError> {
    let mut out = Vec::with_capacity(parsed.hosts.len());
    for host in &parsed.hosts {
        out.push(SshConfigCandidate {
            alias: host.alias.clone(),
            hostname: host.hostname.clone(),
            port: host.port,
            user: host.user.clone(),
            identity_files: host
                .identity_files
                .iter()
                .map(|p| p.display().to_string())
                .collect(),
            proxy_jump: host.proxy_jump.clone(),
            already_saved: is_already_saved(vault, host).await?,
        });
    }
    Ok(out)
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_config_preview(
    app: AppHandle,
    state: State<'_, VaultState>,
    path: Option<String>,
) -> Result<SshConfigPreview, CommandError> {
    let home = home_dir(&app)?;
    let path = config_path(path, &home);
    let parsed = read_ssh_config(&path, &home)?;
    Ok(SshConfigPreview {
        path: path.display().to_string(),
        candidates: candidates(state.vault()?, &parsed).await?,
        unsupported: parsed.unsupported,
    })
}

/// Re-reads the config instead of trusting host details sent back by the UI.
#[tauri::command]
#[specta::specta]
pub async fn ssh_config_import(
    app: AppHandle,
    state: State<'_, VaultState>,
    path: Option<String>,
    aliases: Vec<String>,
) -> Result<SshConfigImportResult, CommandError> {
    let home = home_dir(&app)?;
    let parsed = read_ssh_config(&config_path(path, &home), &home)?;
    let summary = import_ssh_config_hosts(state.vault()?, &parsed.hosts, &aliases, &home).await?;
    Ok(SshConfigImportResult {
        created_hosts: summary.created_hosts,
        imported_keys: summary.imported_keys,
        skipped: summary
            .skipped
            .into_iter()
            .map(|(alias, reason)| SkippedHost { alias, reason })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use termirust_core::ssh::parse_ssh_config;
    use termirust_core::storage::Database;
    use termirust_core::vault::{Host, MemoryKeyStore, Vault};

    use super::*;

    #[test]
    fn defaults_to_the_users_ssh_config() {
        let home = PathBuf::from("/home/me");
        assert_eq!(
            config_path(None, &home),
            PathBuf::from("/home/me/.ssh/config")
        );
        assert_eq!(
            config_path(Some("  ".into()), &home),
            PathBuf::from("/home/me/.ssh/config")
        );
        assert_eq!(
            config_path(Some("/etc/ssh/custom".into()), &home),
            PathBuf::from("/etc/ssh/custom")
        );
    }

    #[tokio::test]
    async fn marks_candidates_that_are_already_saved() {
        let db = Database::open_in_memory().await.unwrap();
        let vault = Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap();
        vault
            .hosts()
            .create(&Host {
                username: Some("u".into()),
                ..Host::new("10.0.0.1")
            })
            .await
            .unwrap();
        let parsed = parse_ssh_config(
            "Host old\n  HostName 10.0.0.1\n  User u\nHost new\n  HostName 10.0.0.2\n  IdentityFile /k\n",
            std::path::Path::new("/home/me"),
        );

        let list = candidates(&vault, &parsed).await.unwrap();
        assert_eq!(
            list.iter()
                .map(|c| (c.alias.as_str(), c.already_saved))
                .collect::<Vec<_>>(),
            [("old", true), ("new", false)]
        );
        assert_eq!(list[1].identity_files, ["/k"]);
    }
}

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri::ipc::Channel;
use termirust_core::sftp::{EntryKind, RemoteEntry, SftpClient};

use super::host_session::{
    HostConnection, HostLoginRequest, OpenHostOutcome, PromptedLogin, connect_host,
};
use crate::command_error::CommandError;
use crate::session_registry::SessionRegistry;
use crate::transfer_queue::{TransferEvent, TransferQueue};
use crate::vault_state::VaultState;

pub type SftpSessions = SessionRegistry<SftpClient>;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenSftpRequest {
    pub host_id: String,
    pub prompted: Option<PromptedLogin>,
    pub confirmed_fingerprint: Option<String>,
    pub remember_host_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OpenSftpOutcome {
    #[serde(rename_all = "camelCase")]
    Opened { sftp_id: u32, home: String },
    /// Same prompts as a terminal tab: password, passphrase, username or host key.
    NeedsInput { prompt: OpenHostOutcome },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Directory,
    File,
    Symlink,
    Other,
}

impl From<EntryKind> for FileKind {
    fn from(kind: EntryKind) -> Self {
        match kind {
            EntryKind::Directory => FileKind::Directory,
            EntryKind::File => FileKind::File,
            EntryKind::Symlink => FileKind::Symlink,
            EntryKind::Other => FileKind::Other,
        }
    }
}

/// One row of a file panel, remote or local.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    #[specta(type = u32)]
    pub size: u64,
    /// Seconds since the Unix epoch.
    #[specta(type = Option<u32>)]
    pub modified: Option<i64>,
    pub permissions: Option<u32>,
}

impl From<RemoteEntry> for FileEntry {
    fn from(e: RemoteEntry) -> Self {
        Self {
            name: e.name,
            path: e.path,
            kind: e.kind.into(),
            size: e.size,
            modified: e.modified,
            permissions: e.permissions,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum TransferDirection {
    Upload,
    Download,
}

/// `local_path` and `remote_path` are the full paths of the source and of the item to create.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub sftp_id: u32,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
}

async fn client(
    sessions: &SftpSessions,
    sftp_id: u32,
) -> Result<std::sync::Arc<SftpClient>, CommandError> {
    sessions
        .get(sftp_id)
        .await
        .ok_or_else(|| CommandError::session_not_found(sftp_id))
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_open(
    vault_state: State<'_, VaultState>,
    sessions: State<'_, SftpSessions>,
    request: OpenSftpRequest,
) -> Result<OpenSftpOutcome, CommandError> {
    let vault = vault_state.vault().await?;
    let login = HostLoginRequest {
        host_id: request.host_id,
        prompted: request.prompted,
        confirmed_fingerprint: request.confirmed_fingerprint,
        remember_host_key: request.remember_host_key,
    };
    let connection = match connect_host(&vault, &login).await? {
        HostConnection::Connected(connection) => connection,
        HostConnection::NeedsInput(prompt) => return Ok(OpenSftpOutcome::NeedsInput { prompt }),
    };
    let client = SftpClient::start(connection).await?;
    let home = client.home().await?;
    let sftp_id = sessions.insert(client).await;
    tracing::info!(host_id = %login.host_id, sftp_id, "sftp opened");
    Ok(OpenSftpOutcome::Opened { sftp_id, home })
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_list(
    sessions: State<'_, SftpSessions>,
    sftp_id: u32,
    path: String,
) -> Result<Vec<FileEntry>, CommandError> {
    let entries = client(&sessions, sftp_id).await?.list(&path).await?;
    Ok(entries.into_iter().map(FileEntry::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_create_dir(
    sessions: State<'_, SftpSessions>,
    sftp_id: u32,
    path: String,
) -> Result<(), CommandError> {
    Ok(client(&sessions, sftp_id).await?.create_dir(&path).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_rename(
    sessions: State<'_, SftpSessions>,
    sftp_id: u32,
    from: String,
    to: String,
) -> Result<(), CommandError> {
    Ok(client(&sessions, sftp_id).await?.rename(&from, &to).await?)
}

/// Removes a file, or a directory with everything in it.
#[tauri::command]
#[specta::specta]
pub async fn sftp_remove(
    sessions: State<'_, SftpSessions>,
    sftp_id: u32,
    path: String,
) -> Result<(), CommandError> {
    Ok(client(&sessions, sftp_id).await?.remove(&path).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn sftp_close(
    sessions: State<'_, SftpSessions>,
    sftp_id: u32,
) -> Result<(), CommandError> {
    if let Some(client) = sessions.remove(sftp_id).await {
        client.close().await?;
    }
    Ok(())
}

/// Queues a file or directory transfer; progress, the result and cancellation arrive on `on_event`.
#[tauri::command]
#[specta::specta]
pub async fn sftp_transfer_start(
    sessions: State<'_, SftpSessions>,
    queue: State<'_, TransferQueue>,
    request: TransferRequest,
    on_event: Channel<TransferEvent>,
) -> Result<u32, CommandError> {
    let client = client(&sessions, request.sftp_id).await?;
    let local = PathBuf::from(&request.local_path);
    let remote = request.remote_path;
    let direction = request.direction;
    let id = queue.enqueue(
        move |cancel, sink| async move {
            match direction {
                TransferDirection::Upload => {
                    client.upload_tree(&local, &remote, &cancel, sink).await
                }
                TransferDirection::Download => {
                    client.download_tree(&remote, &local, &cancel, sink).await
                }
            }
        },
        move |event| {
            let _ = on_event.send(event);
        },
    );
    Ok(id)
}

/// Returns false when the transfer had already finished.
#[tauri::command]
#[specta::specta]
pub async fn sftp_transfer_cancel(
    queue: State<'_, TransferQueue>,
    transfer_id: u32,
) -> Result<bool, CommandError> {
    Ok(queue.cancel(transfer_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_entries_become_panel_rows() {
        let row = FileEntry::from(RemoteEntry {
            name: "app.log".into(),
            path: "/var/log/app.log".into(),
            kind: EntryKind::File,
            size: 5_000_000_000,
            modified: Some(1_700_000_000),
            permissions: Some(0o644),
        });
        let json = serde_json::to_value(&row).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "name": "app.log", "path": "/var/log/app.log", "kind": "file",
                "size": 5_000_000_000u64, "modified": 1_700_000_000, "permissions": 0o644
            })
        );
    }

    #[test]
    fn transfer_requests_use_camel_case_fields() {
        let request: TransferRequest = serde_json::from_value(serde_json::json!({
            "sftpId": 3, "direction": "download", "localPath": "/tmp/x", "remotePath": "/srv/x"
        }))
        .unwrap();
        assert_eq!(request.direction, TransferDirection::Download);
        assert_eq!(
            (request.sftp_id, request.remote_path.as_str()),
            (3, "/srv/x")
        );
    }

    #[tokio::test]
    async fn unknown_sftp_sessions_are_reported() {
        let sessions = SftpSessions::default();
        let err = client(&sessions, 9).await.err().unwrap();
        assert_eq!(
            err.code,
            crate::command_error::CommandErrorCode::SessionNotFound
        );
    }
}

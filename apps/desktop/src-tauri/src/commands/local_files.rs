use std::path::Path;

use termirust_core::CoreError;
use termirust_core::local_fs;
use termirust_core::sftp::{MAX_EDIT_BYTES, editable_text};

use super::sftp::FileEntry;
use crate::command_error::CommandError;

#[tauri::command]
#[specta::specta]
pub async fn local_home() -> Result<String, CommandError> {
    let home = local_fs::home_dir().unwrap_or_else(|| Path::new("/").to_path_buf());
    Ok(home.to_string_lossy().into_owned())
}

#[tauri::command]
#[specta::specta]
pub async fn local_list(path: String) -> Result<Vec<FileEntry>, CommandError> {
    let entries = local_fs::list(Path::new(&path))?;
    Ok(entries.into_iter().map(FileEntry::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn local_create_dir(path: String) -> Result<(), CommandError> {
    Ok(local_fs::create_dir(Path::new(&path))?)
}

#[tauri::command]
#[specta::specta]
pub async fn local_create_file(path: String) -> Result<(), CommandError> {
    Ok(local_fs::create_file(Path::new(&path))?)
}

/// Opens a file with the default app, or with `app` (an application path chosen by the user).
#[tauri::command]
#[specta::specta]
pub async fn local_open_file(path: String, app: Option<String>) -> Result<(), CommandError> {
    open_with(Path::new(&path), app)
}

pub(crate) fn open_with(path: &Path, app: Option<String>) -> Result<(), CommandError> {
    tauri_plugin_opener::open_path(path, app.as_deref())
        .map_err(|e| CoreError::InvalidData(format!("cannot open {}: {e}", path.display())).into())
}

#[tauri::command]
#[specta::specta]
pub async fn local_rename(from: String, to: String) -> Result<(), CommandError> {
    Ok(local_fs::rename(Path::new(&from), Path::new(&to))?)
}

/// Removes a file, or a directory with everything in it, without following symlinks.
#[tauri::command]
#[specta::specta]
pub async fn local_remove(path: String) -> Result<(), CommandError> {
    Ok(local_fs::remove(Path::new(&path))?)
}

/// A text file for the built-in editor; binary, non-UTF-8 and files over 2 MB are refused.
#[tauri::command]
#[specta::specta]
pub async fn local_read_text(path: String) -> Result<String, CommandError> {
    let size = std::fs::metadata(&path)
        .map_err(|e| CoreError::InvalidData(format!("cannot read {path}: {e}")))?
        .len();
    if size > MAX_EDIT_BYTES {
        return Err(CoreError::InvalidData(
            "file is larger than 2 MB; open it in another editor".into(),
        )
        .into());
    }
    let bytes = std::fs::read(&path)
        .map_err(|e| CoreError::InvalidData(format!("cannot read {path}: {e}")))?;
    Ok(editable_text(bytes)?)
}

#[tauri::command]
#[specta::specta]
pub async fn local_write_text(path: String, text: String) -> Result<(), CommandError> {
    std::fs::write(&path, text)
        .map_err(|e| CoreError::InvalidData(format!("cannot save {path}: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_and_removes_through_the_commands() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let sub = dir.path().join("logs").to_string_lossy().into_owned();
        local_create_dir(sub.clone()).await.unwrap();

        let rows = local_list(root).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].name.as_str(), rows[0].path.as_str()),
            ("logs", sub.as_str())
        );

        local_remove(sub.clone()).await.unwrap();
        let err = local_remove(sub).await.unwrap_err();
        assert_eq!(
            err.code,
            crate::command_error::CommandErrorCode::InvalidData
        );
    }

    #[tokio::test]
    async fn home_is_never_empty() {
        assert!(!local_home().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn edits_a_text_file_and_refuses_binary() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("hosts").to_string_lossy().into_owned();
        local_write_text(file.clone(), "127.0.0.1 localhost\n".into())
            .await
            .unwrap();
        assert_eq!(
            local_read_text(file.clone()).await.unwrap(),
            "127.0.0.1 localhost\n"
        );

        let binary = dir.path().join("a.out");
        std::fs::write(&binary, [0x7f, b'E', 0, 1]).unwrap();
        let err = local_read_text(binary.to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.message.contains("binary"), "{}", err.message);
    }
}

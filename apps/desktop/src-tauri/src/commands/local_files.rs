use std::path::Path;

use termirust_core::local_fs;

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
pub async fn local_rename(from: String, to: String) -> Result<(), CommandError> {
    Ok(local_fs::rename(Path::new(&from), Path::new(&to))?)
}

/// Removes a file, or a directory with everything in it, without following symlinks.
#[tauri::command]
#[specta::specta]
pub async fn local_remove(path: String) -> Result<(), CommandError> {
    Ok(local_fs::remove(Path::new(&path))?)
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
}

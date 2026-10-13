use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use termirust_core::CoreError;

use crate::command_error::CommandError;

/// Opens the folder holding Termirust's log files in the system file manager.
#[tauri::command]
#[specta::specta]
pub fn logs_open_folder(app: AppHandle) -> Result<(), CommandError> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| CoreError::InvalidData(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| CoreError::InvalidData(e.to_string()))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| CoreError::InvalidData(format!("cannot open the log folder: {e}")).into())
}

use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use termirust_core::pty::{LocalShell, ShellProgram};
use termirust_core::ssh::PtySize;

use super::session::{SessionBackend, SessionClosed, Sessions, start_session};
use crate::command_error::CommandError;
use crate::raw_chunk::RawChunk;

/// Opens the user's login shell on this machine in a new session.
#[tauri::command]
#[specta::specta]
pub async fn session_open_local(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    cols: u32,
    rows: u32,
    on_output: Channel<RawChunk>,
    on_closed: Channel<SessionClosed>,
) -> Result<u32, CommandError> {
    let (shell, events) = LocalShell::spawn(&ShellProgram::UserDefault, PtySize { cols, rows })?;
    Ok(start_session(
        app,
        &sessions,
        SessionBackend::Local(shell),
        events,
        on_output,
        on_closed,
    )
    .await)
}

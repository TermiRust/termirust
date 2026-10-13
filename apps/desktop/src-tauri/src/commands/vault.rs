use serde::Serialize;
use tauri::State;

use crate::command_error::CommandError;
use crate::vault_state::VaultState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultOverview {
    pub hosts: u32,
    pub groups: u32,
    pub identities: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn vault_overview(state: State<'_, VaultState>) -> Result<VaultOverview, CommandError> {
    let vault = state.vault().await?;
    Ok(VaultOverview {
        hosts: vault.hosts().list().await?.len() as u32,
        groups: vault.groups().list().await?.len() as u32,
        identities: vault.identities().list().await?.len() as u32,
    })
}

/// True on the very first launch, before the user has read the onboarding.
#[tauri::command]
#[specta::specta]
pub fn onboarding_needed(app: tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| crate::vault_state::is_first_launch(&dir))
        .unwrap_or(false)
}

/// Called when the user finishes the onboarding: creates the vault, which is when the OS
/// asks for keychain access. Waits until it is open (or failed).
#[tauri::command]
#[specta::specta]
pub async fn onboarding_finish(state: State<'_, VaultState>) -> Result<(), CommandError> {
    state.open().await;
    state.vault().await.map(|_| ())
}

/// Re-opens the vault after a failure (e.g. the keychain prompt was denied) and waits for it.
#[tauri::command]
#[specta::specta]
pub async fn vault_retry_open(state: State<'_, VaultState>) -> Result<(), CommandError> {
    state.open().await;
    state.vault().await.map(|_| ())
}

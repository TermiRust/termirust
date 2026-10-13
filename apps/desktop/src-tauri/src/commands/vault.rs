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
    let vault = state.vault()?;
    Ok(VaultOverview {
        hosts: vault.hosts().list().await?.len() as u32,
        groups: vault.groups().list().await?.len() as u32,
        identities: vault.identities().list().await?.len() as u32,
    })
}

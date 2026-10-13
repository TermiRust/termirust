use serde::{Deserialize, Serialize};
use tauri::State;
use termirust_core::vault::{Snippet, SnippetRecord};

use super::hosts::parse_id;
use crate::command_error::CommandError;
use crate::vault_state::VaultState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SnippetView {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: String,
    pub tags: Vec<String>,
}

impl From<&SnippetRecord> for SnippetView {
    fn from(record: &SnippetRecord) -> Self {
        let s = &record.payload;
        Self {
            id: record.meta.id.to_string(),
            name: s.name.clone(),
            command: s.command.clone(),
            description: s.description.clone(),
            tags: s.tags.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SnippetInput {
    pub name: String,
    pub command: String,
    pub description: String,
    pub tags: Vec<String>,
}

impl From<SnippetInput> for Snippet {
    fn from(input: SnippetInput) -> Self {
        Self {
            name: input.name,
            command: input.command,
            description: input.description,
            tags: input.tags,
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn snippets_list(state: State<'_, VaultState>) -> Result<Vec<SnippetView>, CommandError> {
    let mut snippets: Vec<SnippetView> = state
        .vault()
        .await?
        .snippets()
        .list()
        .await?
        .iter()
        .map(SnippetView::from)
        .collect();
    snippets.sort_by_key(|s| s.name.to_lowercase());
    Ok(snippets)
}

#[tauri::command]
#[specta::specta]
pub async fn snippets_create(
    state: State<'_, VaultState>,
    input: SnippetInput,
) -> Result<SnippetView, CommandError> {
    let record = state
        .vault()
        .await?
        .snippets()
        .create(&input.into())
        .await?;
    Ok((&record).into())
}

#[tauri::command]
#[specta::specta]
pub async fn snippets_update(
    state: State<'_, VaultState>,
    id: String,
    input: SnippetInput,
) -> Result<SnippetView, CommandError> {
    let record = state
        .vault()
        .await?
        .snippets()
        .update(parse_id(&id)?, &input.into())
        .await?;
    Ok((&record).into())
}

#[tauri::command]
#[specta::specta]
pub async fn snippets_delete(state: State<'_, VaultState>, id: String) -> Result<(), CommandError> {
    Ok(state
        .vault()
        .await?
        .snippets()
        .delete(parse_id(&id)?)
        .await?)
}

#[cfg(test)]
mod tests {
    use termirust_core::storage::Database;
    use termirust_core::vault::{MemoryKeyStore, Vault};

    use super::*;

    #[tokio::test]
    async fn round_trips_through_the_view() {
        let db = Database::open_in_memory().await.unwrap();
        let vault = Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap();
        let input: SnippetInput = serde_json::from_str(
            r#"{"name":"Tail","command":"tail -f {{file:/var/log/syslog}}","description":"","tags":["logs"]}"#,
        )
        .unwrap();
        let record = vault.snippets().create(&input.into()).await.unwrap();
        let view = SnippetView::from(&record);
        assert_eq!(view.command, "tail -f {{file:/var/log/syslog}}");
        assert_eq!(view.tags, ["logs"]);
        assert_eq!(view.id, record.meta.id.to_string());
    }
}

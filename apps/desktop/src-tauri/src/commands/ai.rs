use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use termirust_core::CancelFlag;
use termirust_core::ai::provider::{AiClient, ChatMessage, ChatRequest, ProviderKind, Role};
use termirust_core::vault::{AiSettings, Secret, Vault};

use crate::command_error::CommandError;
use crate::vault_state::VaultState;

const TEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AiProviderKind {
    Anthropic,
    OpenAiCompatible,
}

impl From<ProviderKind> for AiProviderKind {
    fn from(kind: ProviderKind) -> Self {
        match kind {
            ProviderKind::Anthropic => Self::Anthropic,
            ProviderKind::OpenAiCompatible => Self::OpenAiCompatible,
        }
    }
}

impl From<AiProviderKind> for ProviderKind {
    fn from(kind: AiProviderKind) -> Self {
        match kind {
            AiProviderKind::Anthropic => Self::Anthropic,
            AiProviderKind::OpenAiCompatible => Self::OpenAiCompatible,
        }
    }
}

/// What the UI may know about the AI settings: whether a key is saved, never the key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    pub enabled: bool,
    pub kind: AiProviderKind,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
}

impl From<&AiSettings> for AiSettingsView {
    fn from(s: &AiSettings) -> Self {
        Self {
            enabled: s.enabled,
            kind: s.kind.into(),
            base_url: s.base_url.clone(),
            model: s.model.clone(),
            has_api_key: s.api_key.is_some(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ApiKeyChange {
    Keep,
    Set { value: String },
    Clear,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsInput {
    pub enabled: bool,
    pub kind: AiProviderKind,
    pub base_url: String,
    pub model: String,
    pub api_key: ApiKeyChange,
}

/// Builds the settings to store; `Keep` reuses the saved key.
async fn settings_from_input(
    vault: &Vault,
    input: AiSettingsInput,
) -> Result<AiSettings, CommandError> {
    let api_key = match input.api_key {
        ApiKeyChange::Keep => vault.ai_settings().get().await?.api_key,
        ApiKeyChange::Set { value } => Some(Secret::new(value)),
        ApiKeyChange::Clear => None,
    };
    Ok(AiSettings {
        enabled: input.enabled,
        kind: input.kind.into(),
        base_url: input.base_url,
        model: input.model,
        api_key,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ai_settings_get(state: State<'_, VaultState>) -> Result<AiSettingsView, CommandError> {
    let settings = state.vault().await?.ai_settings().get().await?;
    Ok((&settings).into())
}

#[tauri::command]
#[specta::specta]
pub async fn ai_settings_set(
    state: State<'_, VaultState>,
    input: AiSettingsInput,
) -> Result<AiSettingsView, CommandError> {
    let vault = state.vault().await?;
    let settings = settings_from_input(&vault, input).await?;
    let saved = vault.ai_settings().save(&settings).await?;
    Ok((&saved).into())
}

/// Sends a one-word prompt with the given (possibly unsaved) settings and returns the reply.
#[tauri::command]
#[specta::specta]
pub async fn ai_test_connection(
    state: State<'_, VaultState>,
    input: AiSettingsInput,
) -> Result<String, CommandError> {
    let vault = state.vault().await?;
    let settings = settings_from_input(&vault, input).await?;
    test_connection(&settings).await
}

async fn test_connection(settings: &AiSettings) -> Result<String, CommandError> {
    let mut config = settings.provider_config();
    if config.base_url.trim().is_empty() {
        config.base_url = settings.kind.default_base_url().into();
    }
    let client = AiClient::new(config)?;
    let chat = ChatRequest {
        system: "Reply with the single word OK.".into(),
        messages: vec![ChatMessage {
            role: Role::User,
            content: "ping".into(),
        }],
        max_tokens: 16,
    };
    let reply = tokio::time::timeout(
        TEST_TIMEOUT,
        client.stream(&chat, &CancelFlag::default(), |_| {}),
    )
    .await
    .map_err(|_| termirust_core::CoreError::Ai("no reply within 30 seconds".into()))??;
    Ok(reply.trim().chars().take(80).collect())
}

#[cfg(test)]
mod tests {
    use termirust_core::storage::Database;
    use termirust_core::vault::MemoryKeyStore;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    fn input(api_key: ApiKeyChange) -> AiSettingsInput {
        AiSettingsInput {
            enabled: true,
            kind: AiProviderKind::OpenAiCompatible,
            base_url: "http://localhost:11434/v1".into(),
            model: "llama3".into(),
            api_key,
        }
    }

    #[tokio::test]
    async fn the_view_never_contains_the_key() {
        let vault = vault().await;
        let settings = settings_from_input(
            &vault,
            input(ApiKeyChange::Set {
                value: "sk-secret".into(),
            }),
        )
        .await
        .unwrap();
        let saved = vault.ai_settings().save(&settings).await.unwrap();
        let view = AiSettingsView::from(&saved);
        assert!(view.has_api_key);
        assert!(!serde_json::to_string(&view).unwrap().contains("sk-secret"));
    }

    #[tokio::test]
    async fn keep_reuses_the_saved_key_and_clear_removes_it() {
        let vault = vault().await;
        let first = settings_from_input(
            &vault,
            input(ApiKeyChange::Set {
                value: "sk-1".into(),
            }),
        )
        .await
        .unwrap();
        vault.ai_settings().save(&first).await.unwrap();

        let kept = settings_from_input(&vault, input(ApiKeyChange::Keep))
            .await
            .unwrap();
        assert_eq!(
            kept.api_key.as_ref().map(|k| k.expose().to_owned()),
            Some("sk-1".into())
        );
        let cleared = settings_from_input(&vault, input(ApiKeyChange::Clear))
            .await
            .unwrap();
        assert!(cleared.api_key.is_none());
    }

    #[test]
    fn input_json_from_the_frontend_is_accepted() {
        let parsed: AiSettingsInput = serde_json::from_str(
            r#"{"enabled":true,"kind":"anthropic","baseUrl":"","model":"","apiKey":{"kind":"set","value":"k"}}"#,
        )
        .unwrap();
        assert_eq!(parsed.kind, AiProviderKind::Anthropic);
        assert!(matches!(parsed.api_key, ApiKeyChange::Set { ref value } if value == "k"));
    }

    #[tokio::test]
    async fn test_connection_returns_the_reply_or_the_reason() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            for body in [
                "HTTP/1.1 200 OK\r\nconnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: [DONE]\n\n",
                "HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n{\"error\":{\"message\":\"bad key\"}}",
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 4096];
                let _ = socket.read(&mut buf).await;
                socket.write_all(body.as_bytes()).await.unwrap();
            }
        });
        let settings = AiSettings {
            enabled: true,
            kind: ProviderKind::OpenAiCompatible,
            base_url: url,
            model: "m".into(),
            api_key: None,
        };
        assert_eq!(test_connection(&settings).await.unwrap(), "OK");
        let err = test_connection(&settings).await.unwrap_err();
        assert!(
            err.message.contains("rejected the API key"),
            "{}",
            err.message
        );
    }
}

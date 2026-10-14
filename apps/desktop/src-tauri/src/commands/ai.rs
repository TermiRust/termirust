use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{Manager, State};
use termirust_core::ai::danger::danger;
use termirust_core::ai::prompts::{
    PreparedRequest, Quote, ShellContext, chat_request, code_blocks,
};
use termirust_core::ai::provider::{AiClient, ChatMessage, ChatRequest, ProviderKind, Role};
use termirust_core::vault::{
    AiChat, AiChatRecord, AiSettings, ChatMessageRecord, ChatQuoteRecord, ChatRole, Secret, Vault,
};
use termirust_core::{CancelFlag, CoreError};

use super::hosts::parse_id;

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

/// Where the terminal runs; decides the environment the model is told about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AiTarget {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AiRole {
    User,
    Assistant,
}

/// An earlier message of the conversation, as shown in the panel.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiTurn {
    pub role: AiRole,
    pub content: String,
}

/// Terminal output the user attached; `label` says where it came from, e.g. "L35–L55".
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiQuote {
    pub label: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiAsk {
    pub target: AiTarget,
    /// The saved host of the tab, so its AI opt-out is enforced here too.
    pub host_id: Option<String>,
    pub history: Vec<AiTurn>,
    /// May be empty when quotes are attached ("explain this").
    pub message: String,
    pub quotes: Vec<AiQuote>,
    /// The visible terminal text, only when the user switched that on.
    pub screen: Option<String>,
}

/// Exactly what would be sent, after masking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiPreview {
    pub provider: String,
    pub system: String,
    pub user: String,
    pub masked: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiEvent {
    Text {
        text: String,
    },
    /// `commands` lists the shell blocks of the reply, each with its danger note.
    #[serde(rename_all = "camelCase")]
    Done {
        reply: String,
        commands: Vec<SuggestedCommand>,
    },
    Failed {
        message: String,
    },
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct SuggestedCommand {
    pub command: String,
    /// Why it deserves a second look, if it does.
    pub danger: Option<String>,
}

/// AI requests in flight, so the UI can cancel one.
#[derive(Default)]
pub struct AiRequests {
    next_id: AtomicU32,
    active: Mutex<HashMap<u32, CancelFlag>>,
}

impl AiRequests {
    fn begin(&self) -> (u32, CancelFlag) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let cancel = CancelFlag::default();
        if let Ok(mut active) = self.active.lock() {
            active.insert(id, cancel.clone());
        }
        (id, cancel)
    }

    fn finish(&self, id: u32) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&id);
        }
    }

    fn cancel(&self, id: u32) -> bool {
        let flag = self.active.lock().ok().and_then(|a| a.get(&id).cloned());
        flag.map(|f| f.cancel()).is_some()
    }
}

fn prepare(ask: &AiAsk) -> PreparedRequest {
    let context = match ask.target {
        AiTarget::Local => ShellContext::local(),
        AiTarget::Remote => ShellContext::remote(),
    };
    let history: Vec<ChatMessage> = ask
        .history
        .iter()
        .map(|t| ChatMessage {
            role: match t.role {
                AiRole::User => Role::User,
                AiRole::Assistant => Role::Assistant,
            },
            content: t.content.clone(),
        })
        .collect();
    let quotes: Vec<Quote> = ask
        .quotes
        .iter()
        .map(|q| Quote {
            label: q.label.clone(),
            text: q.text.clone(),
        })
        .collect();
    chat_request(
        &history,
        &ask.message,
        &quotes,
        ask.screen.as_deref(),
        &context,
    )
}

/// Refuses when AI is off, or turned off for the tab's host or its group.
async fn usable_settings(vault: &Vault, host_id: Option<&str>) -> Result<AiSettings, CommandError> {
    let settings = vault.ai_settings().get().await?;
    if !settings.enabled {
        return Err(CoreError::Ai("AI is turned off; enable it in Settings".into()).into());
    }
    let host = match host_id {
        Some(id) => vault.hosts().get(parse_id(id)?).await?,
        None => None,
    };
    if let Some(host) = host {
        let group_off = match host.payload.group_id {
            Some(group_id) => vault
                .groups()
                .get(group_id)
                .await?
                .is_some_and(|g| g.payload.ai_disabled),
            None => false,
        };
        if host.payload.ai_disabled || group_off {
            return Err(CoreError::Ai("AI is turned off for this host".into()).into());
        }
    }
    Ok(settings)
}

fn provider_label(settings: &AiSettings) -> String {
    let name = match settings.kind {
        ProviderKind::Anthropic => "Anthropic",
        ProviderKind::OpenAiCompatible => "OpenAI-compatible",
    };
    format!("{name} · {} · {}", settings.model, settings.base_url)
}

#[tauri::command]
#[specta::specta]
pub async fn ai_preview(
    state: State<'_, VaultState>,
    ask: AiAsk,
) -> Result<AiPreview, CommandError> {
    let vault = state.vault().await?;
    let settings = usable_settings(&vault, ask.host_id.as_deref()).await?;
    let prepared = prepare(&ask);
    Ok(AiPreview {
        provider: provider_label(&settings),
        system: prepared.chat.system,
        user: prepared
            .chat
            .messages
            .last()
            .map(|m| m.content.clone())
            .unwrap_or_default(),
        masked: u32::try_from(prepared.masked).unwrap_or(u32::MAX),
    })
}

/// Starts a streamed answer and returns its id for [`ai_cancel`].
#[tauri::command]
#[specta::specta]
pub async fn ai_ask(
    app: tauri::AppHandle,
    state: State<'_, VaultState>,
    requests: State<'_, AiRequests>,
    ask: AiAsk,
    on_event: Channel<AiEvent>,
) -> Result<u32, CommandError> {
    let vault = state.vault().await?;
    let settings = usable_settings(&vault, ask.host_id.as_deref()).await?;
    let client = AiClient::new(settings.provider_config())?;
    let prepared = prepare(&ask);
    let (id, cancel) = requests.begin();
    tauri::async_runtime::spawn(async move {
        let outcome = run_ask(&client, prepared, &cancel, |event| {
            let _ = on_event.send(event);
        })
        .await;
        app.state::<AiRequests>().finish(id);
        let _ = on_event.send(outcome);
    });
    Ok(id)
}

async fn run_ask(
    client: &AiClient,
    prepared: PreparedRequest,
    cancel: &CancelFlag,
    mut emit: impl FnMut(AiEvent) + Send,
) -> AiEvent {
    match client
        .stream(&prepared.chat, cancel, |text| {
            emit(AiEvent::Text {
                text: text.to_owned(),
            })
        })
        .await
    {
        Ok(reply) => {
            let commands = code_blocks(&reply)
                .into_iter()
                .map(|command| SuggestedCommand {
                    danger: danger(&command).map(str::to_owned),
                    command,
                })
                .collect();
            AiEvent::Done { reply, commands }
        }
        Err(CoreError::Cancelled) => AiEvent::Cancelled,
        Err(e) => AiEvent::Failed {
            message: CommandError::from(e).message,
        },
    }
}

#[tauri::command]
#[specta::specta]
pub async fn ai_cancel(
    requests: State<'_, AiRequests>,
    request_id: u32,
) -> Result<bool, CommandError> {
    Ok(requests.cancel(request_id))
}

/// A saved conversation as listed in History (messages left out).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiChatSummary {
    pub id: String,
    pub host_id: Option<String>,
    pub host_label: String,
    pub title: String,
    /// Milliseconds since the Unix epoch.
    #[specta(type = f64)]
    pub updated_at: i64,
    pub message_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiChatQuoteDto {
    pub label: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessageDto {
    pub role: AiRole,
    pub text: String,
    pub quotes: Vec<AiChatQuoteDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiChatView {
    pub id: String,
    pub host_id: Option<String>,
    pub host_label: String,
    pub title: String,
    pub messages: Vec<AiChatMessageDto>,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiChatInput {
    /// Absent for a new conversation.
    pub id: Option<String>,
    pub host_id: Option<String>,
    pub host_label: String,
    pub title: String,
    pub messages: Vec<AiChatMessageDto>,
}

fn summary(record: &AiChatRecord) -> AiChatSummary {
    let chat = &record.payload;
    AiChatSummary {
        id: record.meta.id.to_string(),
        host_id: chat.host_id.map(|id| id.to_string()),
        host_label: chat.host_label.clone(),
        title: chat.title.clone(),
        updated_at: record.meta.updated_at,
        message_count: u32::try_from(chat.messages.len()).unwrap_or(u32::MAX),
    }
}

fn to_record(input: AiChatInput) -> Result<AiChat, CommandError> {
    Ok(AiChat {
        host_id: input.host_id.as_deref().map(parse_id).transpose()?,
        host_label: input.host_label,
        title: input.title,
        messages: input
            .messages
            .into_iter()
            .map(|m| ChatMessageRecord {
                role: match m.role {
                    AiRole::User => ChatRole::User,
                    AiRole::Assistant => ChatRole::Assistant,
                },
                text: m.text,
                quotes: m
                    .quotes
                    .into_iter()
                    .map(|q| ChatQuoteRecord {
                        label: q.label,
                        text: q.text,
                    })
                    .collect(),
            })
            .collect(),
    })
}

fn to_view(record: &AiChatRecord) -> AiChatView {
    let chat = &record.payload;
    AiChatView {
        id: record.meta.id.to_string(),
        host_id: chat.host_id.map(|id| id.to_string()),
        host_label: chat.host_label.clone(),
        title: chat.title.clone(),
        messages: chat
            .messages
            .iter()
            .map(|m| AiChatMessageDto {
                role: match m.role {
                    ChatRole::User => AiRole::User,
                    ChatRole::Assistant => AiRole::Assistant,
                },
                text: m.text.clone(),
                quotes: m
                    .quotes
                    .iter()
                    .map(|q| AiChatQuoteDto {
                        label: q.label.clone(),
                        text: q.text.clone(),
                    })
                    .collect(),
            })
            .collect(),
    }
}

/// Saved conversations, newest first. `host_id` narrows to one server; `local` to local terminals.
#[tauri::command]
#[specta::specta]
pub async fn ai_chats_list(
    state: State<'_, VaultState>,
    host_id: Option<String>,
    local: bool,
) -> Result<Vec<AiChatSummary>, CommandError> {
    let chats = state.vault().await?.ai_chats().list().await?;
    Ok(chats
        .iter()
        .filter(|c| match (&host_id, local) {
            (_, true) => c.payload.host_id.is_none(),
            (Some(id), false) => {
                c.payload.host_id.map(|h| h.to_string()).as_deref() == Some(id.as_str())
            }
            (None, false) => true,
        })
        .map(summary)
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn ai_chat_get(
    state: State<'_, VaultState>,
    id: String,
) -> Result<AiChatView, CommandError> {
    let record = state
        .vault()
        .await?
        .ai_chats()
        .get(parse_id(&id)?)
        .await?
        .ok_or(CoreError::NotFound { kind: "chat", id })?;
    Ok(to_view(&record))
}

/// Creates the conversation on first save, then replaces it; returns its summary (with the id).
#[tauri::command]
#[specta::specta]
pub async fn ai_chat_save(
    state: State<'_, VaultState>,
    input: AiChatInput,
) -> Result<AiChatSummary, CommandError> {
    let vault = state.vault().await?;
    save_chat(&vault, input).await
}

async fn save_chat(vault: &Vault, input: AiChatInput) -> Result<AiChatSummary, CommandError> {
    let id = input.id.as_deref().map(parse_id).transpose()?;
    let chat = to_record(input)?;
    let record = match id {
        Some(id) => vault.ai_chats().update(id, &chat).await?,
        None => vault.ai_chats().create(&chat).await?,
    };
    Ok(summary(&record))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_chat_delete(state: State<'_, VaultState>, id: String) -> Result<(), CommandError> {
    Ok(state
        .vault()
        .await?
        .ai_chats()
        .delete(parse_id(&id)?)
        .await?)
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

    async fn enable(vault: &Vault, url: String) {
        vault
            .ai_settings()
            .save(&AiSettings {
                enabled: true,
                kind: ProviderKind::OpenAiCompatible,
                base_url: url,
                model: "m".into(),
                api_key: None,
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn refuses_when_ai_is_off_or_the_host_opted_out() {
        let vault = vault().await;
        let err = usable_settings(&vault, None).await.unwrap_err();
        assert!(err.message.contains("turned off"));

        enable(&vault, "http://127.0.0.1:1".into()).await;
        assert!(usable_settings(&vault, None).await.is_ok());

        let group = vault
            .groups()
            .create(&termirust_core::vault::Group {
                ai_disabled: true,
                ..termirust_core::vault::Group::new("prod")
            })
            .await
            .unwrap();
        let in_group = vault
            .hosts()
            .create(&termirust_core::vault::Host {
                group_id: Some(group.meta.id),
                ..termirust_core::vault::Host::new("db")
            })
            .await
            .unwrap();
        let opted_out = vault
            .hosts()
            .create(&termirust_core::vault::Host {
                ai_disabled: true,
                ..termirust_core::vault::Host::new("x")
            })
            .await
            .unwrap();
        let allowed = vault
            .hosts()
            .create(&termirust_core::vault::Host::new("y"))
            .await
            .unwrap();
        for id in [in_group.meta.id, opted_out.meta.id] {
            let err = usable_settings(&vault, Some(&id.to_string()))
                .await
                .unwrap_err();
            assert!(err.message.contains("turned off for this host"));
        }
        assert!(
            usable_settings(&vault, Some(&allowed.meta.id.to_string()))
                .await
                .is_ok()
        );
    }

    fn ask(message: &str, quotes: Vec<AiQuote>, screen: Option<&str>) -> AiAsk {
        AiAsk {
            target: AiTarget::Remote,
            host_id: None,
            history: vec![AiTurn {
                role: AiRole::User,
                content: "hi".into(),
            }],
            message: message.into(),
            quotes,
            screen: screen.map(Into::into),
        }
    }

    #[test]
    fn previews_are_built_by_the_same_code_that_sends() {
        let prepared = prepare(&ask(
            "",
            vec![AiQuote {
                label: "L3–L4".into(),
                text: "DB_PASSWORD=hunter2 failed".into(),
            }],
            Some("TOKEN=abc"),
        ));
        assert_eq!(prepared.masked, 2);
        assert_eq!(
            prepared.chat.messages.len(),
            2,
            "history plus the new message"
        );
        let last = &prepared.chat.messages[1].content;
        assert!(last.contains("(L3–L4)") && !last.contains("hunter2") && !last.contains("=abc"));
    }

    #[test]
    fn requests_from_the_panel_are_accepted() {
        let parsed: AiAsk = serde_json::from_str(
            r#"{"target":"local","hostId":null,"history":[{"role":"assistant","content":"x"}],"message":"why?","quotes":[{"label":"L1–L2","text":"err"}],"screen":null}"#,
        )
        .unwrap();
        assert_eq!(parsed.history[0].role, AiRole::Assistant);
        assert_eq!(parsed.quotes[0].label, "L1–L2");
    }

    async fn one_reply_server(body: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 8192];
            let _ = socket.read(&mut buf).await;
            socket.write_all(body.as_bytes()).await.unwrap();
        });
        url
    }

    #[tokio::test]
    async fn answers_stream_and_list_their_commands_with_danger_notes() {
        let url = one_reply_server(
            "HTTP/1.1 200 OK\r\nconnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"Clean it:\\n```sh\\nrm -rf ./build\\n```\\nThen:\\n```sh\\nls\\n```\"}}]}\n\ndata: [DONE]\n\n",
        )
        .await;
        let vault = vault().await;
        enable(&vault, url).await;
        let client =
            AiClient::new(vault.ai_settings().get().await.unwrap().provider_config()).unwrap();
        let mut streamed = Vec::new();
        let done = run_ask(
            &client,
            prepare(&ask("clean the build", vec![], None)),
            &CancelFlag::default(),
            |e| streamed.push(e),
        )
        .await;
        assert_eq!(streamed.len(), 1);
        assert_eq!(
            done,
            AiEvent::Done {
                reply: "Clean it:\n```sh\nrm -rf ./build\n```\nThen:\n```sh\nls\n```".into(),
                commands: vec![
                    SuggestedCommand {
                        command: "rm -rf ./build".into(),
                        danger: Some("deletes files recursively without asking".into()),
                    },
                    SuggestedCommand {
                        command: "ls".into(),
                        danger: None,
                    },
                ],
            }
        );
    }

    #[tokio::test]
    async fn failures_say_why() {
        let dead = AiClient::new(termirust_core::ai::provider::ProviderConfig {
            kind: ProviderKind::OpenAiCompatible,
            base_url: "http://127.0.0.1:1".into(),
            model: "m".into(),
            api_key: None,
        })
        .unwrap();
        let failed = run_ask(
            &dead,
            prepare(&ask("?", vec![], None)),
            &CancelFlag::default(),
            |_| {},
        )
        .await;
        assert!(
            matches!(failed, AiEvent::Failed { ref message } if message.contains("could not reach"))
        );
    }

    #[test]
    fn cancels_only_requests_in_flight() {
        let requests = AiRequests::default();
        let (id, flag) = requests.begin();
        assert!(requests.cancel(id));
        assert!(flag.is_cancelled());
        requests.finish(id);
        assert!(!requests.cancel(id));
    }

    fn chat_input(id: Option<String>, host_id: Option<String>, text: &str) -> AiChatInput {
        AiChatInput {
            id,
            host_id,
            host_label: "prod-db".into(),
            title: "slow queries".into(),
            messages: vec![
                AiChatMessageDto {
                    role: AiRole::User,
                    text: text.into(),
                    quotes: vec![AiChatQuoteDto {
                        label: "L3–L4".into(),
                        text: "ERROR".into(),
                    }],
                },
                AiChatMessageDto {
                    role: AiRole::Assistant,
                    text: "Check `pg_stat_activity`.".into(),
                    quotes: vec![],
                },
            ],
        }
    }

    #[tokio::test]
    async fn saves_a_conversation_then_updates_the_same_one() {
        let vault = vault().await;
        let host = vault
            .hosts()
            .create(&termirust_core::vault::Host::new("db"))
            .await
            .unwrap()
            .meta
            .id
            .to_string();
        let first = save_chat(&vault, chat_input(None, Some(host.clone()), "why slow?"))
            .await
            .unwrap();
        assert_eq!(
            (first.message_count, first.host_id.as_deref()),
            (2, Some(host.as_str()))
        );

        let mut more = chat_input(Some(first.id.clone()), Some(host.clone()), "why slow?");
        more.messages.push(AiChatMessageDto {
            role: AiRole::User,
            text: "and now?".into(),
            quotes: vec![],
        });
        let second = save_chat(&vault, more).await.unwrap();
        assert_eq!(second.id, first.id);
        assert_eq!(second.message_count, 3);

        let record = vault
            .ai_chats()
            .get(parse_id(&first.id).unwrap())
            .await
            .unwrap()
            .unwrap();
        let view = to_view(&record);
        assert_eq!(view.messages[0].quotes[0].label, "L3–L4");
        assert_eq!(view.messages.len(), 3);
    }

    #[test]
    fn chat_input_from_the_panel_is_accepted() {
        let parsed: AiChatInput = serde_json::from_str(
            r#"{"id":null,"hostId":null,"hostLabel":"Local","title":"t","messages":[{"role":"user","text":"hi","quotes":[]}]}"#,
        )
        .unwrap();
        assert!(parsed.id.is_none() && parsed.host_id.is_none());
        assert!(to_record(parsed).is_ok());
    }
}

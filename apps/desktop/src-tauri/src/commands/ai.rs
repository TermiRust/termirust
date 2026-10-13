use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{Manager, State};
use termirust_core::ai::danger::danger;
use termirust_core::ai::prompts::{
    PreparedRequest, ShellContext, code_blocks, command_request, explain_request, extract_command,
};
use termirust_core::ai::provider::{AiClient, ChatMessage, ChatRequest, ProviderKind, Role};
use termirust_core::vault::{AiSettings, Secret, Vault};
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

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum AiQuestion {
    /// ⌘I: describe a task, get one command back.
    Command { prompt: String },
    /// Ask about selected output; `question` may be empty.
    Explain { selection: String, question: String },
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiAsk {
    pub target: AiTarget,
    /// The saved host of the tab, so its AI opt-out is enforced here too.
    pub host_id: Option<String>,
    pub question: AiQuestion,
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
    /// `command` is set in command mode; `commands` lists code blocks in explanations.
    #[serde(rename_all = "camelCase")]
    Done {
        reply: String,
        command: Option<String>,
        danger: Option<String>,
        commands: Vec<String>,
    },
    Failed {
        message: String,
    },
    Cancelled,
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

fn prepare(question: &AiQuestion, target: AiTarget) -> PreparedRequest {
    let context = match target {
        AiTarget::Local => ShellContext::local(),
        AiTarget::Remote => ShellContext::remote(),
    };
    match question {
        AiQuestion::Command { prompt } => command_request(prompt, &context),
        AiQuestion::Explain {
            selection,
            question,
        } => explain_request(selection, question, &context),
    }
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
    let prepared = prepare(&ask.question, ask.target);
    Ok(AiPreview {
        provider: provider_label(&settings),
        system: prepared.chat.system,
        user: prepared
            .chat
            .messages
            .into_iter()
            .map(|m| m.content)
            .collect::<Vec<_>>()
            .join("\n\n"),
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
    let prepared = prepare(&ask.question, ask.target);
    let command_mode = matches!(ask.question, AiQuestion::Command { .. });
    let (id, cancel) = requests.begin();
    tauri::async_runtime::spawn(async move {
        let outcome = run_ask(&client, prepared, command_mode, &cancel, |event| {
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
    command_mode: bool,
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
            let command = if command_mode {
                extract_command(&reply)
            } else {
                None
            };
            let commands = if command_mode {
                Vec::new()
            } else {
                code_blocks(&reply)
            };
            let danger = command
                .as_deref()
                .and_then(danger)
                .or_else(|| commands.iter().find_map(|c| danger(c)))
                .map(str::to_owned);
            AiEvent::Done {
                reply,
                command,
                danger,
                commands,
            }
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

    #[test]
    fn previews_are_built_by_the_same_code_that_sends() {
        let prepared = prepare(
            &AiQuestion::Explain {
                selection: "DB_PASSWORD=hunter2 failed".into(),
                question: String::new(),
            },
            AiTarget::Remote,
        );
        assert_eq!(prepared.masked, 1);
        assert!(!prepared.chat.messages[0].content.contains("hunter2"));
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
    async fn command_answers_carry_the_command_and_its_danger() {
        let url = one_reply_server(
            "HTTP/1.1 200 OK\r\nconnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"rm -rf ./build\"}}]}\n\ndata: [DONE]\n\n",
        )
        .await;
        let vault = vault().await;
        enable(&vault, url).await;
        let client =
            AiClient::new(vault.ai_settings().get().await.unwrap().provider_config()).unwrap();
        let mut streamed = Vec::new();
        let done = run_ask(
            &client,
            prepare(
                &AiQuestion::Command {
                    prompt: "clean the build".into(),
                },
                AiTarget::Local,
            ),
            true,
            &CancelFlag::default(),
            |e| streamed.push(e),
        )
        .await;
        assert_eq!(
            streamed,
            [AiEvent::Text {
                text: "rm -rf ./build".into()
            }]
        );
        assert_eq!(
            done,
            AiEvent::Done {
                reply: "rm -rf ./build".into(),
                command: Some("rm -rf ./build".into()),
                danger: Some("deletes files recursively without asking".into()),
                commands: vec![],
            }
        );
    }

    #[tokio::test]
    async fn explanations_list_their_commands_and_failures_say_why() {
        let url = one_reply_server(
            "HTTP/1.1 200 OK\r\nconnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"Port busy.\\n```sh\\nlsof -i :80\\n```\"}}]}\n\ndata: [DONE]\n\n",
        )
        .await;
        let vault = vault().await;
        enable(&vault, url).await;
        let client =
            AiClient::new(vault.ai_settings().get().await.unwrap().provider_config()).unwrap();
        let question = AiQuestion::Explain {
            selection: "bind: address already in use".into(),
            question: String::new(),
        };
        let done = run_ask(
            &client,
            prepare(&question, AiTarget::Remote),
            false,
            &CancelFlag::default(),
            |_| {},
        )
        .await;
        assert!(
            matches!(done, AiEvent::Done { ref commands, command: None, danger: None, .. } if commands == &vec!["lsof -i :80".to_owned()])
        );

        let dead = AiClient::new(termirust_core::ai::provider::ProviderConfig {
            kind: ProviderKind::OpenAiCompatible,
            base_url: "http://127.0.0.1:1".into(),
            model: "m".into(),
            api_key: None,
        })
        .unwrap();
        let failed = run_ask(
            &dead,
            prepare(&question, AiTarget::Remote),
            false,
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
}

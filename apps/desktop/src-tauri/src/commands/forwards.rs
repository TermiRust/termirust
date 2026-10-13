use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use termirust_core::forward::{Forward, start_dynamic, start_local, start_remote};
use termirust_core::ssh::SshConnection;
use termirust_core::vault::{ForwardSpec, PortForwardRecord, PortForwardRule, Vault};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::host_session::{
    HostConnection, HostLoginRequest, OpenHostOutcome, PromptedLogin, connect_host,
};
use super::hosts::parse_id;
use crate::command_error::CommandError;
use crate::vault_state::VaultState;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ForwardSpecDto {
    #[serde(rename_all = "camelCase")]
    Local {
        bind_host: String,
        bind_port: u16,
        target_host: String,
        target_port: u16,
    },
    #[serde(rename_all = "camelCase")]
    Remote {
        remote_host: String,
        remote_port: u16,
        local_host: String,
        local_port: u16,
    },
    #[serde(rename_all = "camelCase")]
    Dynamic { bind_host: String, bind_port: u16 },
}

impl From<&ForwardSpec> for ForwardSpecDto {
    fn from(spec: &ForwardSpec) -> Self {
        match spec.clone() {
            ForwardSpec::Local {
                bind_host,
                bind_port,
                target_host,
                target_port,
            } => Self::Local {
                bind_host,
                bind_port,
                target_host,
                target_port,
            },
            ForwardSpec::Remote {
                remote_host,
                remote_port,
                local_host,
                local_port,
            } => Self::Remote {
                remote_host,
                remote_port,
                local_host,
                local_port,
            },
            ForwardSpec::Dynamic {
                bind_host,
                bind_port,
            } => Self::Dynamic {
                bind_host,
                bind_port,
            },
        }
    }
}

impl From<ForwardSpecDto> for ForwardSpec {
    fn from(dto: ForwardSpecDto) -> Self {
        match dto {
            ForwardSpecDto::Local {
                bind_host,
                bind_port,
                target_host,
                target_port,
            } => Self::Local {
                bind_host,
                bind_port,
                target_host,
                target_port,
            },
            ForwardSpecDto::Remote {
                remote_host,
                remote_port,
                local_host,
                local_port,
            } => Self::Remote {
                remote_host,
                remote_port,
                local_host,
                local_port,
            },
            ForwardSpecDto::Dynamic {
                bind_host,
                bind_port,
            } => Self::Dynamic {
                bind_host,
                bind_port,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForwardRuleView {
    pub id: String,
    pub label: String,
    pub host_id: String,
    pub spec: ForwardSpecDto,
    pub auto_start: bool,
    /// The equivalent OpenSSH flag, e.g. "-L 127.0.0.1:5432:db:5432".
    pub summary: String,
}

impl From<&PortForwardRecord> for ForwardRuleView {
    fn from(record: &PortForwardRecord) -> Self {
        let rule = &record.payload;
        Self {
            id: record.meta.id.to_string(),
            label: rule.label.clone(),
            host_id: rule.host_id.to_string(),
            spec: (&rule.spec).into(),
            auto_start: rule.auto_start,
            summary: rule.spec.describe(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForwardRuleInput {
    pub label: String,
    pub host_id: String,
    pub spec: ForwardSpecDto,
    pub auto_start: bool,
}

impl ForwardRuleInput {
    fn into_rule(self) -> Result<PortForwardRule, CommandError> {
        Ok(PortForwardRule {
            label: self.label,
            host_id: parse_id(&self.host_id)?,
            spec: self.spec.into(),
            auto_start: self.auto_start,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ForwardState {
    Stopped,
    Starting,
    #[serde(rename_all = "camelCase")]
    Running {
        listening_on: String,
        active: u32,
        #[specta(type = u32)]
        total: u64,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ForwardStatus {
    pub rule_id: String,
    pub state: ForwardState,
}

enum Slot {
    Starting,
    Running {
        forward: Forward,
        connection: Arc<SshConnection>,
    },
    Failed(String),
}

/// Forwards started in this run of the app. Each owns its SSH connection, so closing a
/// terminal tab never takes a tunnel down with it.
#[derive(Default)]
pub struct RunningForwards {
    slots: Mutex<HashMap<Uuid, Slot>>,
}

impl RunningForwards {
    async fn state(&self, id: Uuid) -> ForwardState {
        let mut slots = self.slots.lock().await;
        let lost = matches!(slots.get(&id), Some(Slot::Running { connection, .. }) if connection.is_closed());
        if lost {
            slots.insert(id, Slot::Failed("the SSH connection was lost".into()));
        }
        match slots.get(&id) {
            None => ForwardState::Stopped,
            Some(Slot::Starting) => ForwardState::Starting,
            Some(Slot::Running { forward, .. }) => {
                let stats = forward.stats();
                ForwardState::Running {
                    listening_on: forward.listening_on().to_owned(),
                    active: stats.active,
                    total: stats.total,
                }
            }
            Some(Slot::Failed(message)) => ForwardState::Failed {
                message: message.clone(),
            },
        }
    }

    /// Claims the rule for starting; false when it is already starting or running.
    async fn claim(&self, id: Uuid) -> bool {
        let mut slots = self.slots.lock().await;
        if matches!(slots.get(&id), Some(Slot::Starting | Slot::Running { .. })) {
            return false;
        }
        slots.insert(id, Slot::Starting);
        true
    }

    async fn settle(&self, id: Uuid, slot: Option<Slot>) {
        let mut slots = self.slots.lock().await;
        // A stop while connecting wins: the fresh forward is dropped instead of stored.
        if !matches!(slots.get(&id), Some(Slot::Starting)) {
            return;
        }
        match slot {
            Some(slot) => slots.insert(id, slot),
            None => slots.remove(&id),
        };
    }

    async fn stop(&self, id: Uuid) {
        let slot = self.slots.lock().await.remove(&id);
        if let Some(Slot::Running {
            forward,
            connection,
        }) = slot
        {
            forward.stop().await;
            let _ = connection.disconnect().await;
        }
    }
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StartForwardRequest {
    pub rule_id: String,
    pub prompted: Option<PromptedLogin>,
    pub confirmed_fingerprint: Option<String>,
    pub remember_host_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum StartForwardOutcome {
    /// `state` is Running, or Failed with the reason (busy port, unreachable host…).
    Started {
        state: ForwardState,
    },
    NeedsInput {
        prompt: OpenHostOutcome,
    },
}

async fn rule(vault: &Vault, id: Uuid) -> Result<PortForwardRule, CommandError> {
    Ok(vault
        .port_forwards()
        .get(id)
        .await?
        .ok_or_else(|| termirust_core::CoreError::NotFound {
            kind: "port forward",
            id: id.to_string(),
        })?
        .payload)
}

async fn open_forward(
    connection: Arc<SshConnection>,
    spec: &ForwardSpec,
) -> termirust_core::Result<Forward> {
    match spec {
        ForwardSpec::Local {
            bind_host,
            bind_port,
            target_host,
            target_port,
        } => start_local(connection, bind_host, *bind_port, target_host, *target_port).await,
        ForwardSpec::Remote {
            remote_host,
            remote_port,
            local_host,
            local_port,
        } => {
            start_remote(
                connection,
                remote_host,
                *remote_port,
                local_host,
                *local_port,
            )
            .await
        }
        ForwardSpec::Dynamic {
            bind_host,
            bind_port,
        } => start_dynamic(connection, bind_host, *bind_port).await,
    }
}

async fn start_rule(
    vault: &Vault,
    running: &RunningForwards,
    request: StartForwardRequest,
) -> Result<StartForwardOutcome, CommandError> {
    let id = parse_id(&request.rule_id)?;
    let rule = rule(vault, id).await?;
    if !running.claim(id).await {
        return Ok(StartForwardOutcome::Started {
            state: running.state(id).await,
        });
    }
    let login = HostLoginRequest {
        host_id: rule.host_id.to_string(),
        prompted: request.prompted,
        confirmed_fingerprint: request.confirmed_fingerprint,
        remember_host_key: request.remember_host_key,
    };
    let slot = match connect_host(vault, &login).await {
        Ok(HostConnection::NeedsInput(prompt)) => {
            running.settle(id, None).await;
            return Ok(StartForwardOutcome::NeedsInput { prompt });
        }
        Ok(HostConnection::Connected(connection)) => {
            let connection = Arc::new(connection);
            match open_forward(connection.clone(), &rule.spec).await {
                Ok(forward) => {
                    tracing::info!(rule_id = %id, listening_on = forward.listening_on(), "port forward started");
                    Slot::Running {
                        forward,
                        connection,
                    }
                }
                Err(e) => {
                    let _ = connection.disconnect().await;
                    Slot::Failed(CommandError::from(e).message)
                }
            }
        }
        Err(e) => Slot::Failed(e.message),
    };
    if let Slot::Failed(message) = &slot {
        tracing::warn!(rule_id = %id, error = %message, "port forward failed to start");
    }
    running.settle(id, Some(slot)).await;
    Ok(StartForwardOutcome::Started {
        state: running.state(id).await,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn forwards_list(
    state: State<'_, VaultState>,
) -> Result<Vec<ForwardRuleView>, CommandError> {
    let rules = state.vault().await?.port_forwards().list().await?;
    Ok(rules.iter().map(ForwardRuleView::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn forwards_create(
    state: State<'_, VaultState>,
    input: ForwardRuleInput,
) -> Result<ForwardRuleView, CommandError> {
    let record = state
        .vault()
        .await?
        .port_forwards()
        .create(&input.into_rule()?)
        .await?;
    Ok((&record).into())
}

/// Saving a running rule stops it, so the next start uses the new addresses.
#[tauri::command]
#[specta::specta]
pub async fn forwards_update(
    state: State<'_, VaultState>,
    running: State<'_, RunningForwards>,
    id: String,
    input: ForwardRuleInput,
) -> Result<ForwardRuleView, CommandError> {
    let id = parse_id(&id)?;
    let record = state
        .vault()
        .await?
        .port_forwards()
        .update(id, &input.into_rule()?)
        .await?;
    running.stop(id).await;
    Ok((&record).into())
}

#[tauri::command]
#[specta::specta]
pub async fn forwards_delete(
    state: State<'_, VaultState>,
    running: State<'_, RunningForwards>,
    id: String,
) -> Result<(), CommandError> {
    let id = parse_id(&id)?;
    running.stop(id).await;
    Ok(state.vault().await?.port_forwards().delete(id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn forwards_start(
    state: State<'_, VaultState>,
    running: State<'_, RunningForwards>,
    request: StartForwardRequest,
) -> Result<StartForwardOutcome, CommandError> {
    let vault = state.vault().await?;
    start_rule(&vault, &running, request).await
}

#[tauri::command]
#[specta::specta]
pub async fn forwards_stop(
    running: State<'_, RunningForwards>,
    rule_id: String,
) -> Result<(), CommandError> {
    running.stop(parse_id(&rule_id)?).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn forwards_status(
    state: State<'_, VaultState>,
    running: State<'_, RunningForwards>,
) -> Result<Vec<ForwardStatus>, CommandError> {
    let mut statuses = Vec::new();
    for record in state.vault().await?.port_forwards().list().await? {
        statuses.push(ForwardStatus {
            rule_id: record.meta.id.to_string(),
            state: running.state(record.meta.id).await,
        });
    }
    Ok(statuses)
}

/// Starts the host's auto-start rules once its terminal tab connected. A rule that would need
/// a typed secret fails with a hint instead of interrupting the terminal with a prompt.
#[tauri::command]
#[specta::specta]
pub async fn forwards_auto_start(
    state: State<'_, VaultState>,
    running: State<'_, RunningForwards>,
    host_id: String,
) -> Result<Vec<ForwardStatus>, CommandError> {
    let vault = state.vault().await?;
    auto_start(&vault, &running, parse_id(&host_id)?).await
}

async fn auto_start(
    vault: &Vault,
    running: &RunningForwards,
    host_id: Uuid,
) -> Result<Vec<ForwardStatus>, CommandError> {
    let mut statuses = Vec::new();
    for record in vault.port_forwards().list().await? {
        if record.payload.host_id != host_id || !record.payload.auto_start {
            continue;
        }
        let id = record.meta.id;
        let request = StartForwardRequest {
            rule_id: id.to_string(),
            prompted: None,
            confirmed_fingerprint: None,
            remember_host_key: false,
        };
        let state = match start_rule(vault, running, request).await? {
            StartForwardOutcome::Started { state } => state,
            StartForwardOutcome::NeedsInput { .. } => {
                let message =
                    "needs a password or host key confirmation; start it from Port forwarding"
                        .to_owned();
                running
                    .slots
                    .lock()
                    .await
                    .insert(id, Slot::Failed(message.clone()));
                ForwardState::Failed { message }
            }
        };
        statuses.push(ForwardStatus {
            rule_id: id.to_string(),
            state,
        });
    }
    Ok(statuses)
}

#[cfg(test)]
mod tests {
    use termirust_core::storage::Database;
    use termirust_core::vault::{Host, HostAuth, MemoryKeyStore, Secret};

    use super::*;

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    async fn host(vault: &Vault, auth: HostAuth) -> Uuid {
        let host = Host {
            port: 1, // nothing listens here
            username: Some("deploy".into()),
            auth,
            ..Host::new("127.0.0.1")
        };
        vault.hosts().create(&host).await.unwrap().meta.id
    }

    fn input(host_id: Uuid, auto_start: bool) -> ForwardRuleInput {
        ForwardRuleInput {
            label: String::new(),
            host_id: host_id.to_string(),
            spec: ForwardSpecDto::Local {
                bind_host: String::new(),
                bind_port: 15432,
                target_host: "db".into(),
                target_port: 5432,
            },
            auto_start,
        }
    }

    fn start(id: Uuid) -> StartForwardRequest {
        StartForwardRequest {
            rule_id: id.to_string(),
            prompted: None,
            confirmed_fingerprint: None,
            remember_host_key: true,
        }
    }

    #[tokio::test]
    async fn rules_round_trip_through_the_view() {
        let vault = vault().await;
        let host_id = host(&vault, HostAuth::Agent).await;
        let record = vault
            .port_forwards()
            .create(&input(host_id, true).into_rule().unwrap())
            .await
            .unwrap();
        let view = ForwardRuleView::from(&record);
        assert_eq!(view.summary, "-L 127.0.0.1:15432:db:5432");
        assert_eq!(view.host_id, host_id.to_string());
        assert!(view.auto_start);
        let json = serde_json::to_value(&view.spec).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"kind": "local", "bindHost": "127.0.0.1", "bindPort": 15432, "targetHost": "db", "targetPort": 5432})
        );
    }

    #[tokio::test]
    async fn a_rule_that_cannot_connect_is_marked_failed_with_the_reason() {
        let vault = vault().await;
        let host_id = host(
            &vault,
            HostAuth::Password {
                password: Some(Secret::new("pw")),
            },
        )
        .await;
        let id = vault
            .port_forwards()
            .create(&input(host_id, false).into_rule().unwrap())
            .await
            .unwrap()
            .meta
            .id;
        let running = RunningForwards::default();
        assert_eq!(running.state(id).await, ForwardState::Stopped);

        let outcome = start_rule(&vault, &running, start(id)).await.unwrap();
        let StartForwardOutcome::Started {
            state: ForwardState::Failed { message },
        } = outcome
        else {
            panic!("expected a failure, got {outcome:?}");
        };
        assert!(message.contains("127.0.0.1:1"), "{message}");
        assert!(matches!(
            running.state(id).await,
            ForwardState::Failed { .. }
        ));

        running.stop(id).await;
        assert_eq!(running.state(id).await, ForwardState::Stopped);
    }

    #[tokio::test]
    async fn a_missing_password_asks_instead_of_failing() {
        let vault = vault().await;
        let host_id = host(&vault, HostAuth::Password { password: None }).await;
        let id = vault
            .port_forwards()
            .create(&input(host_id, true).into_rule().unwrap())
            .await
            .unwrap()
            .meta
            .id;
        let running = RunningForwards::default();
        let outcome = start_rule(&vault, &running, start(id)).await.unwrap();
        assert!(matches!(
            outcome,
            StartForwardOutcome::NeedsInput {
                prompt: OpenHostOutcome::NeedsPassword { .. }
            }
        ));
        assert_eq!(running.state(id).await, ForwardState::Stopped);

        // Auto start never prompts over a terminal; it explains what to do instead.
        let statuses = auto_start(&vault, &running, host_id).await.unwrap();
        assert!(
            matches!(&statuses[0].state, ForwardState::Failed { message } if message.contains("Port forwarding"))
        );
    }

    #[tokio::test]
    async fn auto_start_only_touches_the_hosts_auto_start_rules() {
        let vault = vault().await;
        let host_id = host(&vault, HostAuth::Agent).await;
        let other = host(&vault, HostAuth::Agent).await;
        vault
            .port_forwards()
            .create(&input(host_id, false).into_rule().unwrap())
            .await
            .unwrap();
        vault
            .port_forwards()
            .create(&input(other, true).into_rule().unwrap())
            .await
            .unwrap();
        let running = RunningForwards::default();
        assert!(
            auto_start(&vault, &running, host_id)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_rule_already_starting_is_not_started_twice() {
        let running = RunningForwards::default();
        let id = Uuid::now_v7();
        assert!(running.claim(id).await);
        assert!(!running.claim(id).await);
        assert_eq!(running.state(id).await, ForwardState::Starting);

        // Stopping while connecting discards the late result.
        running.stop(id).await;
        running.settle(id, Some(Slot::Failed("late".into()))).await;
        assert_eq!(running.state(id).await, ForwardState::Stopped);
    }

    #[tokio::test]
    #[ignore = "needs docker compose -f docker/test-ssh.yml up -d"]
    async fn starts_counts_and_stops_a_forward_through_the_test_server() {
        let vault = vault().await;
        let host = Host {
            port: 2222,
            username: Some("termirust".into()),
            auth: HostAuth::Password {
                password: Some(Secret::new("termirust-test")),
            },
            ..Host::new("127.0.0.1")
        };
        let host_id = vault.hosts().create(&host).await.unwrap().meta.id;
        let mut rule = input(host_id, true);
        rule.spec = ForwardSpecDto::Local {
            bind_host: String::new(),
            bind_port: 38_022,
            target_host: "ssh-target".into(),
            target_port: 2222,
        };
        let id = vault
            .port_forwards()
            .create(&rule.into_rule().unwrap())
            .await
            .unwrap()
            .meta
            .id;
        let running = RunningForwards::default();

        // The server's key is unknown at first, exactly as in a terminal tab.
        let fingerprint = match start_rule(&vault, &running, start(id)).await.unwrap() {
            StartForwardOutcome::NeedsInput {
                prompt: OpenHostOutcome::HostKeyUnknown { fingerprint, .. },
            } => fingerprint,
            other => panic!("expected a host key prompt, got {other:?}"),
        };
        let mut confirmed = start(id);
        confirmed.confirmed_fingerprint = Some(fingerprint);
        let outcome = start_rule(&vault, &running, confirmed).await.unwrap();
        assert!(
            matches!(&outcome, StartForwardOutcome::Started { state: ForwardState::Running { listening_on, .. } } if listening_on == "127.0.0.1:38022"),
            "{outcome:?}"
        );

        let mut socket = tokio::net::TcpStream::connect("127.0.0.1:38022")
            .await
            .unwrap();
        let mut banner = [0u8; 7];
        tokio::io::AsyncReadExt::read_exact(&mut socket, &mut banner)
            .await
            .unwrap();
        assert_eq!(&banner, b"SSH-2.0");
        assert!(matches!(
            running.state(id).await,
            ForwardState::Running {
                active: 1,
                total: 1,
                ..
            }
        ));

        running.stop(id).await;
        assert_eq!(running.state(id).await, ForwardState::Stopped);
        assert!(
            tokio::net::TcpStream::connect("127.0.0.1:38022")
                .await
                .is_err()
        );
    }
}

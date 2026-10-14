//! Monitor screen: a cached connection per watched host and a quick health snapshot on demand.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use termirust_core::ssh::{HostStats, SshConnection, TopProcess};
use tokio::sync::Mutex;

use super::host_session::{
    HostConnection, HostLoginRequest, OpenHostOutcome, PromptedLogin, connect_host,
};
use crate::command_error::CommandError;
use crate::vault_state::VaultState;

/// Connections kept open between refreshes so polling does not log in every few seconds.
#[derive(Default)]
pub struct MonitorConnections(Mutex<HashMap<String, Arc<SshConnection>>>);

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MonitorProbeRequest {
    pub host_id: String,
    pub prompted: Option<PromptedLogin>,
    pub confirmed_fingerprint: Option<String>,
    pub remember_host_key: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDto {
    pub cpu_percent: f64,
    pub mem_percent: f64,
    pub command: String,
}

/// Sizes are KiB as f64 so they stay plain numbers in TypeScript.
#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostStatsDto {
    pub os_id: Option<String>,
    pub os_name: Option<String>,
    pub kernel: Option<String>,
    pub hostname: Option<String>,
    pub uptime_secs: Option<f64>,
    pub load: Option<Vec<f64>>,
    pub cpu_count: Option<u32>,
    pub cpu_percent: Option<f64>,
    pub mem_total_kb: Option<f64>,
    pub mem_available_kb: Option<f64>,
    pub swap_total_kb: Option<f64>,
    pub swap_free_kb: Option<f64>,
    pub disk_total_kb: Option<f64>,
    pub disk_used_kb: Option<f64>,
    pub disk_mount: Option<String>,
    pub addresses: Vec<String>,
    pub top_processes: Vec<ProcessDto>,
}

fn num(v: Option<u64>) -> Option<f64> {
    v.map(|v| v as f64)
}

impl From<HostStats> for HostStatsDto {
    fn from(s: HostStats) -> Self {
        Self {
            os_id: s.os_id,
            os_name: s.os_name,
            kernel: s.kernel,
            hostname: s.hostname,
            uptime_secs: num(s.uptime_secs),
            load: s.load.map(|l| l.to_vec()),
            cpu_count: s.cpu_count,
            cpu_percent: s.cpu_percent,
            mem_total_kb: num(s.mem_total_kb),
            mem_available_kb: num(s.mem_available_kb),
            swap_total_kb: num(s.swap_total_kb),
            swap_free_kb: num(s.swap_free_kb),
            disk_total_kb: num(s.disk_total_kb),
            disk_used_kb: num(s.disk_used_kb),
            disk_mount: s.disk_mount,
            addresses: s.addresses,
            top_processes: s
                .top_processes
                .into_iter()
                .map(|p: TopProcess| ProcessDto {
                    cpu_percent: p.cpu_percent,
                    mem_percent: p.mem_percent,
                    command: p.command,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum MonitorProbeOutcome {
    Stats {
        stats: Box<HostStatsDto>,
    },
    /// Same prompts as a terminal tab: password, passphrase, username or host key.
    NeedsInput {
        prompt: OpenHostOutcome,
    },
}

impl MonitorConnections {
    async fn cached(&self, host_id: &str) -> Option<Arc<SshConnection>> {
        let mut map = self.0.lock().await;
        match map.get(host_id) {
            Some(c) if !c.is_closed() => Some(Arc::clone(c)),
            Some(_) => {
                map.remove(host_id);
                None
            }
            None => None,
        }
    }

    async fn forget(&self, host_id: &str) -> Option<Arc<SshConnection>> {
        self.0.lock().await.remove(host_id)
    }
}

/// Logs in on first use (or after the connection dropped), then reads a snapshot.
#[tauri::command]
#[specta::specta]
pub async fn monitor_probe(
    vault_state: State<'_, VaultState>,
    connections: State<'_, MonitorConnections>,
    request: MonitorProbeRequest,
) -> Result<MonitorProbeOutcome, CommandError> {
    let connection = match connections.cached(&request.host_id).await {
        Some(c) => c,
        None => {
            let vault = vault_state.vault().await?;
            let login = HostLoginRequest {
                host_id: request.host_id.clone(),
                prompted: request.prompted,
                confirmed_fingerprint: request.confirmed_fingerprint,
                remember_host_key: request.remember_host_key,
            };
            let connection = match connect_host(&vault, &login).await? {
                HostConnection::Connected(c) => Arc::new(c),
                HostConnection::NeedsInput(prompt) => {
                    return Ok(MonitorProbeOutcome::NeedsInput { prompt });
                }
            };
            connections
                .0
                .lock()
                .await
                .insert(request.host_id.clone(), Arc::clone(&connection));
            connection
        }
    };
    match connection.host_stats().await {
        Ok(stats) => Ok(MonitorProbeOutcome::Stats {
            stats: Box::new(stats.into()),
        }),
        Err(err) => {
            // A broken connection is dropped so the next refresh logs in again.
            connections.forget(&request.host_id).await;
            Err(err.into())
        }
    }
}

/// Closes the host's monitor connection when its card leaves the screen.
#[tauri::command]
#[specta::specta]
pub async fn monitor_forget(
    connections: State<'_, MonitorConnections>,
    host_id: String,
) -> Result<(), CommandError> {
    if let Some(connection) = connections.forget(&host_id).await
        && Arc::strong_count(&connection) == 1
    {
        connection.disconnect().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use termirust_core::ssh::parse_stats;

    #[test]
    fn converts_a_snapshot_for_the_webview() {
        let stats = parse_stats(
            "@@load\n0.5 0.25 0.1 1/2 3\n@@mem\nMemTotal: 2048 kB\n@@procs\n 9.0 1.5 java -jar app.jar\n@@end",
        );
        let dto = HostStatsDto::from(stats);
        assert_eq!(dto.load, Some(vec![0.5, 0.25, 0.1]));
        assert_eq!(dto.mem_total_kb, Some(2048.0));
        assert_eq!(dto.mem_available_kb, None);
        assert_eq!(
            dto.top_processes,
            [ProcessDto {
                cpu_percent: 9.0,
                mem_percent: 1.5,
                command: "java -jar app.jar".into()
            }]
        );
    }
}

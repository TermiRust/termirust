use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use termirust_core::CoreError;
use termirust_core::ssh::{HostKeyInfo, PasswordLogin, PtySize, ShellEvent, ShellSession};
use termirust_core::terminal::{BatchPolicy, OutputFlowControl, forward_in_batches};
use tokio::sync::mpsc;

use crate::command_error::CommandError;
use crate::raw_chunk::RawChunk;
use crate::session_registry::SessionRegistry;

/// A connected shell plus the backpressure state of its output stream.
pub struct LiveSession {
    shell: ShellSession,
    output_flow: Arc<OutputFlowControl>,
}

pub type Sessions = SessionRegistry<LiveSession>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PasswordSessionRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub cols: u32,
    pub rows: u32,
    /// Fingerprint the user has already confirmed for this host, if any.
    pub trusted_fingerprint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OpenSessionOutcome {
    #[serde(rename_all = "camelCase")]
    Opened { session_id: u32 },
    /// The server's key is not trusted yet; ask the user, then retry with `trusted_fingerprint`.
    #[serde(rename_all = "camelCase")]
    HostKeyNeedsConfirmation {
        algorithm: String,
        fingerprint: String,
    },
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionClosed {
    pub exit_status: Option<u32>,
}

/// Trusts only the fingerprint the user confirmed and remembers whichever key was offered.
fn confirmed_fingerprint_verifier(
    trusted: Option<String>,
) -> (
    impl Fn(&HostKeyInfo) -> bool + Send + Sync + 'static,
    Arc<Mutex<Option<HostKeyInfo>>>,
) {
    let offered = Arc::new(Mutex::new(None));
    let seen = offered.clone();
    let verifier = move |key: &HostKeyInfo| {
        if let Ok(mut slot) = seen.lock() {
            *slot = Some(key.clone());
        }
        trusted.as_deref() == Some(key.fingerprint.as_str())
    };
    (verifier, offered)
}

#[tauri::command]
#[specta::specta]
pub async fn session_open_with_password(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    request: PasswordSessionRequest,
    on_output: Channel<RawChunk>,
    on_closed: Channel<SessionClosed>,
) -> Result<OpenSessionOutcome, CommandError> {
    let login = PasswordLogin {
        host: request.host,
        port: request.port,
        username: request.username,
        password: request.password,
    };
    let size = PtySize {
        cols: request.cols,
        rows: request.rows,
    };
    let (verifier, offered_key) = confirmed_fingerprint_verifier(request.trusted_fingerprint);

    let (session, mut events) =
        match ShellSession::open_with_password(&login, size, Arc::new(verifier), CONNECT_TIMEOUT)
            .await
        {
            Ok(opened) => opened,
            Err(CoreError::HostKeyRejected) => {
                let offered = offered_key.lock().ok().and_then(|k| k.clone());
                return match offered {
                    Some(key) => Ok(OpenSessionOutcome::HostKeyNeedsConfirmation {
                        algorithm: key.algorithm,
                        fingerprint: key.fingerprint,
                    }),
                    None => Err(CoreError::HostKeyRejected.into()),
                };
            }
            Err(err) => return Err(err.into()),
        };

    let output_flow = Arc::new(OutputFlowControl::default());
    let session_id = sessions
        .insert(LiveSession {
            shell: session,
            output_flow: output_flow.clone(),
        })
        .await;

    let (bytes_tx, bytes_rx) = mpsc::channel::<Vec<u8>>(256);
    let sent = output_flow.clone();
    let forwarder = tauri::async_runtime::spawn(forward_in_batches(
        bytes_rx,
        BatchPolicy::default(),
        move |batch| {
            sent.record_sent(batch.len());
            on_output.send(RawChunk(batch)).is_ok()
        },
    ));

    tauri::async_runtime::spawn(async move {
        let mut exit_status = None;
        while let Some(event) = events.recv().await {
            match event {
                ShellEvent::Output(bytes) => {
                    // Not reading the channel while paused lets SSH window flow control slow the server.
                    output_flow.wait_for_capacity().await;
                    if bytes_tx.send(bytes).await.is_err() {
                        break;
                    }
                }
                ShellEvent::Closed { exit_status: code } => {
                    exit_status = code;
                    break;
                }
            }
        }
        drop(bytes_tx);
        let _ = forwarder.await;
        app.state::<Sessions>().remove(session_id).await;
        let _ = on_closed.send(SessionClosed { exit_status });
    });

    Ok(OpenSessionOutcome::Opened { session_id })
}

#[tauri::command]
#[specta::specta]
pub async fn session_write(
    sessions: State<'_, Sessions>,
    session_id: u32,
    data: String,
) -> Result<(), CommandError> {
    let session = sessions
        .get(session_id)
        .await
        .ok_or_else(|| CommandError::session_not_found(session_id))?;
    session
        .shell
        .write(data.as_bytes())
        .await
        .map_err(Into::into)
}

/// Called by the frontend after xterm has rendered `bytes` of this session's output.
#[tauri::command]
#[specta::specta]
pub async fn session_acknowledge_output(
    sessions: State<'_, Sessions>,
    session_id: u32,
    bytes: u32,
) -> Result<(), CommandError> {
    let session = sessions
        .get(session_id)
        .await
        .ok_or_else(|| CommandError::session_not_found(session_id))?;
    session.output_flow.acknowledge(bytes as usize);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn session_resize(
    sessions: State<'_, Sessions>,
    session_id: u32,
    cols: u32,
    rows: u32,
) -> Result<(), CommandError> {
    let session = sessions
        .get(session_id)
        .await
        .ok_or_else(|| CommandError::session_not_found(session_id))?;
    session
        .shell
        .resize(PtySize { cols, rows })
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn session_close(
    sessions: State<'_, Sessions>,
    session_id: u32,
) -> Result<(), CommandError> {
    match sessions.remove(session_id).await {
        Some(session) => session.shell.close().await.map_err(Into::into),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(fingerprint: &str) -> HostKeyInfo {
        HostKeyInfo {
            algorithm: "ssh-ed25519".into(),
            fingerprint: fingerprint.into(),
        }
    }

    #[test]
    fn rejects_any_key_when_nothing_is_trusted_but_remembers_it() {
        let (verify, offered) = confirmed_fingerprint_verifier(None);
        assert!(!verify(&key("SHA256:abc")));
        assert_eq!(offered.lock().unwrap().clone(), Some(key("SHA256:abc")));
    }

    #[test]
    fn accepts_only_the_confirmed_fingerprint() {
        let (verify, _) = confirmed_fingerprint_verifier(Some("SHA256:abc".into()));
        assert!(verify(&key("SHA256:abc")));
        assert!(!verify(&key("SHA256:changed")));
    }

    #[test]
    fn outcome_serialises_with_a_status_tag_in_camel_case() {
        let opened = serde_json::to_string(&OpenSessionOutcome::Opened { session_id: 3 }).unwrap();
        assert_eq!(opened, r#"{"status":"opened","sessionId":3}"#);

        let confirm = serde_json::to_string(&OpenSessionOutcome::HostKeyNeedsConfirmation {
            algorithm: "ssh-ed25519".into(),
            fingerprint: "SHA256:abc".into(),
        })
        .unwrap();
        assert_eq!(
            confirm,
            r#"{"status":"hostKeyNeedsConfirmation","algorithm":"ssh-ed25519","fingerprint":"SHA256:abc"}"#
        );
    }

    #[test]
    fn request_accepts_camel_case_json_from_the_frontend() {
        let request: PasswordSessionRequest = serde_json::from_str(
            r#"{"host":"h","port":22,"username":"u","password":"p","cols":80,"rows":24,"trustedFingerprint":null}"#,
        )
        .unwrap();
        assert_eq!(request.port, 22);
        assert_eq!(request.trusted_fingerprint, None);
    }
}

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use termirust_core::CoreError;
use termirust_core::ssh::{HostKeyInfo, PasswordLogin, PtySize, ShellSession};
use termirust_core::vault::{Host, HostAuth, HostKeyStatus, Identity, Secret};
use uuid::Uuid;

use super::session::{SessionClosed, Sessions, start_session};
use crate::command_error::CommandError;
use crate::raw_chunk::RawChunk;
use crate::vault_state::VaultState;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Credentials the user typed because the host had none saved (or they were rejected).
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PromptedLogin {
    pub username: Option<String>,
    pub password: String,
    /// Save the password (and username) into the host after a successful login.
    pub remember: bool,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenHostRequest {
    pub host_id: String,
    pub cols: u32,
    pub rows: u32,
    pub prompted: Option<PromptedLogin>,
    /// Fingerprint the user just confirmed in the host-key dialog.
    pub confirmed_fingerprint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OpenHostOutcome {
    #[serde(rename_all = "camelCase")]
    Opened { session_id: u32 },
    #[serde(rename_all = "camelCase")]
    NeedsPassword {
        username_required: bool,
        saved_password_rejected: bool,
    },
    #[serde(rename_all = "camelCase")]
    HostKeyUnknown {
        algorithm: String,
        fingerprint: String,
    },
    #[serde(rename_all = "camelCase")]
    HostKeyChanged {
        algorithm: String,
        fingerprint: String,
        previous_fingerprint: String,
    },
}

#[derive(Debug, PartialEq)]
enum LoginPlan {
    Ready {
        username: String,
        password: Secret,
        from_vault: bool,
    },
    NeedsPassword {
        username_required: bool,
    },
}

/// Picks the username and password for a host: typed values win, then the host, then its identity.
fn plan_login(
    host: &Host,
    identity: Option<&Identity>,
    prompted: Option<&PromptedLogin>,
) -> Result<LoginPlan, CoreError> {
    if host.jump_host_id.is_some() {
        return Err(CoreError::InvalidData(
            "jump hosts are not supported yet".into(),
        ));
    }
    let typed_username = prompted
        .and_then(|p| p.username.as_deref())
        .map(str::trim)
        .filter(|u| !u.is_empty());
    let username = typed_username
        .map(str::to_owned)
        .or_else(|| host.username.clone())
        .or_else(|| identity.map(|i| i.username.clone()));
    let typed_password = prompted
        .map(|p| Secret::new(p.password.clone()))
        .filter(|p| !p.is_empty());

    let saved_password = match &host.auth {
        HostAuth::Password { password } => password.clone(),
        HostAuth::Identity { .. } => {
            let identity = identity.ok_or_else(|| {
                CoreError::InvalidData("the host's identity no longer exists".into())
            })?;
            if identity.password.is_none() && identity.private_key.is_some() {
                return Err(CoreError::InvalidData(
                    "private key login is not supported yet".into(),
                ));
            }
            identity.password.clone()
        }
        HostAuth::Agent => {
            return Err(CoreError::InvalidData(
                "SSH agent login is not supported yet".into(),
            ));
        }
    };

    match (username, typed_password, saved_password) {
        (Some(username), Some(password), _) => Ok(LoginPlan::Ready {
            username,
            password,
            from_vault: false,
        }),
        (Some(username), None, Some(password)) => Ok(LoginPlan::Ready {
            username,
            password,
            from_vault: true,
        }),
        (username, _, _) => Ok(LoginPlan::NeedsPassword {
            username_required: username.is_none(),
        }),
    }
}

/// Accepts the key already trusted for this server or the one the user just confirmed.
fn host_key_decision(
    status: &HostKeyStatus,
    offered: &HostKeyInfo,
    confirmed: Option<&str>,
) -> bool {
    matches!(status, HostKeyStatus::Trusted) || confirmed == Some(offered.fingerprint.as_str())
}

#[tauri::command]
#[specta::specta]
pub async fn session_open_host(
    app: AppHandle,
    vault_state: State<'_, VaultState>,
    sessions: State<'_, Sessions>,
    request: OpenHostRequest,
    on_output: Channel<RawChunk>,
    on_closed: Channel<SessionClosed>,
) -> Result<OpenHostOutcome, CommandError> {
    let vault = vault_state.vault()?;
    let host_id = Uuid::parse_str(&request.host_id)
        .map_err(|_| CoreError::InvalidData(format!("invalid host id: {}", request.host_id)))?;
    let host = vault
        .hosts()
        .get(host_id)
        .await?
        .ok_or_else(|| CoreError::NotFound {
            kind: "host",
            id: request.host_id.clone(),
        })?
        .payload;
    let identity = match &host.auth {
        HostAuth::Identity { identity_id } => vault
            .identities()
            .get(*identity_id)
            .await?
            .map(|r| r.payload),
        _ => None,
    };

    let (username, password, from_vault) =
        match plan_login(&host, identity.as_ref(), request.prompted.as_ref())? {
            LoginPlan::Ready {
                username,
                password,
                from_vault,
            } => (username, password, from_vault),
            LoginPlan::NeedsPassword { username_required } => {
                return Ok(OpenHostOutcome::NeedsPassword {
                    username_required,
                    saved_password_rejected: false,
                });
            }
        };

    let known = vault.known_hosts().find(&host.hostname, host.port).await?;
    let confirmed = request.confirmed_fingerprint.clone();
    let offered: Arc<std::sync::Mutex<Option<(HostKeyInfo, HostKeyStatus)>>> = Arc::default();
    let seen = offered.clone();
    let verifier = move |key: &HostKeyInfo| {
        let status = match &known {
            None => HostKeyStatus::Unknown,
            Some(k) if k.payload.fingerprint == key.fingerprint => HostKeyStatus::Trusted,
            Some(k) => HostKeyStatus::Changed {
                previous_fingerprint: k.payload.fingerprint.clone(),
            },
        };
        let accept = host_key_decision(&status, key, confirmed.as_deref());
        if let Ok(mut slot) = seen.lock() {
            *slot = Some((key.clone(), status));
        }
        accept
    };

    let login = PasswordLogin {
        host: host.hostname.clone(),
        port: host.port,
        username: username.clone(),
        password: password.expose().to_owned(),
    };
    let size = PtySize {
        cols: request.cols,
        rows: request.rows,
    };
    let opened =
        ShellSession::open_with_password(&login, size, Arc::new(verifier), CONNECT_TIMEOUT).await;

    let (shell, events) = match opened {
        Ok(opened) => opened,
        Err(CoreError::HostKeyRejected) => {
            let seen = offered.lock().ok().and_then(|s| s.clone());
            return match seen {
                Some((
                    key,
                    HostKeyStatus::Changed {
                        previous_fingerprint,
                    },
                )) => Ok(OpenHostOutcome::HostKeyChanged {
                    algorithm: key.algorithm,
                    fingerprint: key.fingerprint,
                    previous_fingerprint,
                }),
                Some((key, _)) => Ok(OpenHostOutcome::HostKeyUnknown {
                    algorithm: key.algorithm,
                    fingerprint: key.fingerprint,
                }),
                None => Err(CoreError::HostKeyRejected.into()),
            };
        }
        Err(CoreError::AuthenticationFailed) => {
            return Ok(OpenHostOutcome::NeedsPassword {
                username_required: false,
                saved_password_rejected: from_vault,
            });
        }
        Err(err) => return Err(err.into()),
    };

    // Persist only after the server proved it holds the key and accepted the login.
    if let Some((key, status)) = offered.lock().ok().and_then(|s| s.clone())
        && !matches!(status, HostKeyStatus::Trusted)
    {
        vault
            .known_hosts()
            .trust(&host.hostname, host.port, &key)
            .await?;
    }
    if let Some(prompted) = request.prompted.as_ref().filter(|p| p.remember)
        && matches!(host.auth, HostAuth::Password { .. })
    {
        let mut updated = host.clone();
        updated.auth = HostAuth::Password {
            password: Some(Secret::new(prompted.password.clone())),
        };
        if updated.username.is_none() {
            updated.username = Some(username);
        }
        vault.hosts().update(host_id, &updated).await?;
    }

    let session_id = start_session(app, &sessions, shell, events, on_output, on_closed).await;
    Ok(OpenHostOutcome::Opened { session_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn password_host(saved: Option<&str>, username: Option<&str>) -> Host {
        Host {
            username: username.map(Into::into),
            auth: HostAuth::Password {
                password: saved.map(Secret::new),
            },
            ..Host::new("10.0.0.1")
        }
    }

    fn typed(username: Option<&str>, password: &str) -> PromptedLogin {
        PromptedLogin {
            username: username.map(Into::into),
            password: password.into(),
            remember: false,
        }
    }

    fn ready(username: &str, password: &str, from_vault: bool) -> LoginPlan {
        LoginPlan::Ready {
            username: username.into(),
            password: Secret::new(password),
            from_vault,
        }
    }

    #[test]
    fn uses_the_saved_password_without_asking() {
        let plan = plan_login(&password_host(Some("pw"), Some("deploy")), None, None).unwrap();
        assert_eq!(plan, ready("deploy", "pw", true));
    }

    #[test]
    fn asks_for_a_password_when_none_is_saved() {
        let plan = plan_login(&password_host(None, Some("deploy")), None, None).unwrap();
        assert_eq!(
            plan,
            LoginPlan::NeedsPassword {
                username_required: false
            }
        );
    }

    #[test]
    fn asks_for_the_username_too_when_the_host_has_none() {
        let plan = plan_login(&password_host(Some("pw"), None), None, None).unwrap();
        assert_eq!(
            plan,
            LoginPlan::NeedsPassword {
                username_required: true
            }
        );
    }

    #[test]
    fn typed_credentials_win_over_saved_ones() {
        let host = password_host(Some("old"), Some("deploy"));
        let plan = plan_login(&host, None, Some(&typed(Some(" root "), "new"))).unwrap();
        assert_eq!(plan, ready("root", "new", false));
    }

    #[test]
    fn a_blank_typed_password_falls_back_to_the_saved_one() {
        let host = password_host(Some("saved"), Some("deploy"));
        let plan = plan_login(&host, None, Some(&typed(None, ""))).unwrap();
        assert_eq!(plan, ready("deploy", "saved", true));
    }

    #[test]
    fn identity_supplies_username_and_password() {
        let identity = Identity::with_password("ops", "ops", "idpw");
        let host = Host {
            auth: HostAuth::Identity {
                identity_id: Uuid::now_v7(),
            },
            ..Host::new("h")
        };
        assert_eq!(
            plan_login(&host, Some(&identity), None).unwrap(),
            ready("ops", "idpw", true)
        );
    }

    #[test]
    fn reports_logins_that_are_not_supported_yet() {
        let key_only = Identity {
            password: None,
            private_key: Some(Secret::new("-----BEGIN OPENSSH PRIVATE KEY-----")),
            ..Identity::with_password("k", "k", "x")
        };
        let identity_host = Host {
            auth: HostAuth::Identity {
                identity_id: Uuid::now_v7(),
            },
            ..Host::new("h")
        };
        let cases: [(Host, Option<&Identity>, &str); 4] = [
            (
                Host {
                    auth: HostAuth::Agent,
                    ..Host::new("h")
                },
                None,
                "agent",
            ),
            (identity_host.clone(), Some(&key_only), "private key"),
            (identity_host, None, "no longer exists"),
            (
                Host {
                    jump_host_id: Some(Uuid::now_v7()),
                    ..password_host(Some("pw"), Some("u"))
                },
                None,
                "jump hosts",
            ),
        ];
        for (host, identity, message) in cases {
            let err = plan_login(&host, identity, None).unwrap_err();
            assert!(
                matches!(&err, CoreError::InvalidData(m) if m.contains(message)),
                "{err:?}"
            );
        }
    }

    #[test]
    fn host_key_is_accepted_only_when_trusted_or_just_confirmed() {
        let key = HostKeyInfo {
            algorithm: "ssh-ed25519".into(),
            fingerprint: "SHA256:new".into(),
        };
        let changed = HostKeyStatus::Changed {
            previous_fingerprint: "SHA256:old".into(),
        };

        assert!(host_key_decision(&HostKeyStatus::Trusted, &key, None));
        assert!(!host_key_decision(&HostKeyStatus::Unknown, &key, None));
        assert!(host_key_decision(
            &HostKeyStatus::Unknown,
            &key,
            Some("SHA256:new")
        ));
        assert!(!host_key_decision(&changed, &key, None));
        assert!(!host_key_decision(&changed, &key, Some("SHA256:old")));
        assert!(host_key_decision(&changed, &key, Some("SHA256:new")));
    }

    #[test]
    fn outcomes_serialise_for_the_frontend() {
        let json = serde_json::to_value(OpenHostOutcome::HostKeyChanged {
            algorithm: "ssh-ed25519".into(),
            fingerprint: "SHA256:new".into(),
            previous_fingerprint: "SHA256:old".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"status":"hostKeyChanged","algorithm":"ssh-ed25519","fingerprint":"SHA256:new","previousFingerprint":"SHA256:old"})
        );
        let needs = serde_json::to_value(OpenHostOutcome::NeedsPassword {
            username_required: true,
            saved_password_rejected: false,
        })
        .unwrap();
        assert_eq!(
            needs,
            serde_json::json!({"status":"needsPassword","usernameRequired":true,"savedPasswordRejected":false})
        );
    }
}

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use termirust_core::CoreError;
use termirust_core::ssh::{
    HostKeyInfo, LoginMethod, PtySize, ShellSession, SshLogin, inspect_private_key,
};
use termirust_core::vault::{
    Host, HostAuth, HostKeyStatus, Identity, IdentityRecord, Secret, Vault,
};
use uuid::Uuid;

use super::session::{SessionClosed, Sessions, start_session};
use crate::command_error::CommandError;
use crate::raw_chunk::RawChunk;
use crate::vault_state::VaultState;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// What the user typed because the vault had nothing (or something that was rejected).
#[derive(Debug, Clone, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PromptedLogin {
    pub username: Option<String>,
    pub password: Option<String>,
    pub passphrase: Option<String>,
    /// Save what was typed (password into the host, passphrase into the key) after a successful login.
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
    NeedsPassphrase {
        key_label: String,
        wrong_passphrase: bool,
        username_required: bool,
    },
    /// Key and agent logins still need a username when neither the host nor the key has one.
    NeedsUsername,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SecretSource {
    Vault,
    Typed,
    None,
}

#[derive(Debug)]
enum LoginPlan {
    Ready {
        username: String,
        method: LoginMethod,
        secret: SecretSource,
    },
    NeedsPassword {
        username_required: bool,
    },
    NeedsPassphrase {
        key_label: String,
        username_required: bool,
    },
    NeedsUsername,
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

fn password_plan(
    username: Option<String>,
    typed: Option<String>,
    saved: Option<&Secret>,
) -> LoginPlan {
    match (username, typed, saved) {
        (Some(username), Some(password), _) => LoginPlan::Ready {
            username,
            method: LoginMethod::Password(password),
            secret: SecretSource::Typed,
        },
        (Some(username), None, Some(saved)) => LoginPlan::Ready {
            username,
            method: LoginMethod::Password(saved.expose().to_owned()),
            secret: SecretSource::Vault,
        },
        (username, _, _) => LoginPlan::NeedsPassword {
            username_required: username.is_none(),
        },
    }
}

/// Decides how to log in; typed values win over the host, which wins over its key.
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
    let typed = prompted.cloned().unwrap_or_default();
    let username = non_empty(typed.username.as_deref())
        .or_else(|| host.username.clone())
        .or_else(|| identity.and_then(|i| i.username.clone()));
    let typed_password = typed.password.filter(|p| !p.is_empty());

    match &host.auth {
        HostAuth::Password { password } => {
            Ok(password_plan(username, typed_password, password.as_ref()))
        }
        HostAuth::Agent => Ok(match username {
            Some(username) => LoginPlan::Ready {
                username,
                method: LoginMethod::Agent { socket: None },
                secret: SecretSource::None,
            },
            None => LoginPlan::NeedsUsername,
        }),
        HostAuth::Identity { .. } => {
            let identity = identity
                .ok_or_else(|| CoreError::InvalidData("the host's key no longer exists".into()))?;
            let Some(pem) = identity.private_key.as_ref() else {
                return Ok(password_plan(
                    username,
                    typed_password,
                    identity.password.as_ref(),
                ));
            };
            let (passphrase, secret) = match (
                typed.passphrase.filter(|p| !p.is_empty()),
                &identity.passphrase,
            ) {
                (Some(typed), _) => (Some(typed), SecretSource::Typed),
                (None, Some(saved)) => (Some(saved.expose().to_owned()), SecretSource::Vault),
                (None, None) => (None, SecretSource::None),
            };
            let encrypted = inspect_private_key(pem.expose(), None)?.encrypted;
            let needs_passphrase = encrypted && passphrase.is_none();
            Ok(match username {
                Some(username) if !needs_passphrase => LoginPlan::Ready {
                    username,
                    method: LoginMethod::PrivateKey {
                        pem: pem.expose().to_owned(),
                        passphrase,
                    },
                    secret,
                },
                None if !needs_passphrase => LoginPlan::NeedsUsername,
                username => LoginPlan::NeedsPassphrase {
                    key_label: identity.label.clone(),
                    username_required: username.is_none(),
                },
            })
        }
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
    let identity_record = match &host.auth {
        HostAuth::Identity { identity_id } => vault.identities().get(*identity_id).await?,
        _ => None,
    };
    let identity = identity_record.as_ref().map(|r| &r.payload);

    let (username, method, secret) = match plan_login(&host, identity, request.prompted.as_ref())? {
        LoginPlan::Ready {
            username,
            method,
            secret,
        } => (username, method, secret),
        LoginPlan::NeedsPassword { username_required } => {
            return Ok(OpenHostOutcome::NeedsPassword {
                username_required,
                saved_password_rejected: false,
            });
        }
        LoginPlan::NeedsPassphrase {
            key_label,
            username_required,
        } => {
            return Ok(OpenHostOutcome::NeedsPassphrase {
                key_label,
                wrong_passphrase: false,
                username_required,
            });
        }
        LoginPlan::NeedsUsername => return Ok(OpenHostOutcome::NeedsUsername),
    };
    let uses_password = matches!(method, LoginMethod::Password(_));
    let key_label = identity.map(|i| i.label.clone()).unwrap_or_default();

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

    let login = SshLogin {
        host: host.hostname.clone(),
        port: host.port,
        username: username.clone(),
        method,
    };
    let size = PtySize {
        cols: request.cols,
        rows: request.rows,
    };
    let (shell, events) =
        match ShellSession::open(&login, size, Arc::new(verifier), CONNECT_TIMEOUT).await {
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
            Err(CoreError::AuthenticationFailed) if uses_password => {
                return Ok(OpenHostOutcome::NeedsPassword {
                    username_required: false,
                    saved_password_rejected: secret == SecretSource::Vault,
                });
            }
            Err(CoreError::WrongPassphrase) => {
                return Ok(OpenHostOutcome::NeedsPassphrase {
                    key_label,
                    wrong_passphrase: true,
                    username_required: false,
                });
            }
            Err(CoreError::PassphraseRequired) => {
                return Ok(OpenHostOutcome::NeedsPassphrase {
                    key_label,
                    wrong_passphrase: false,
                    username_required: false,
                });
            }
            Err(CoreError::AuthenticationFailed) => {
                return Err(CoreError::InvalidData(format!(
                    "{} did not accept the key for user {username}",
                    host.hostname
                ))
                .into());
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
    if let Some(prompted) = request.prompted.as_ref().filter(|p| p.remember) {
        remember_typed_secrets(
            vault,
            host_id,
            &host,
            identity_record.as_ref(),
            prompted,
            &username,
            secret,
        )
        .await?;
    }

    let session_id = start_session(app, &sessions, shell, events, on_output, on_closed).await;
    Ok(OpenHostOutcome::Opened { session_id })
}

/// Saves what the user typed and asked to remember, only after it was proven to work.
async fn remember_typed_secrets(
    vault: &Vault,
    host_id: Uuid,
    host: &Host,
    identity: Option<&IdentityRecord>,
    prompted: &PromptedLogin,
    username: &str,
    secret: SecretSource,
) -> Result<(), CoreError> {
    let mut updated = host.clone();
    if updated.username.is_none() {
        updated.username = Some(username.to_owned());
    }
    if let (HostAuth::Password { .. }, Some(password)) = (
        &host.auth,
        prompted.password.as_ref().filter(|p| !p.is_empty()),
    ) {
        updated.auth = HostAuth::Password {
            password: Some(Secret::new(password.clone())),
        };
    }
    if updated != *host {
        vault.hosts().update(host_id, &updated).await?;
    }
    if let (Some(record), Some(passphrase), SecretSource::Typed) =
        (identity, prompted.passphrase.as_ref(), secret)
    {
        let mut key = record.payload.clone();
        key.passphrase = Some(Secret::new(passphrase.clone()));
        vault.identities().update(record.meta.id, &key).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use termirust_core::storage::Database;
    use termirust_core::vault::MemoryKeyStore;

    use super::*;

    const ED25519: &str = include_str!("../../../../../crates/core/tests/fixtures/keys/ed25519");
    const ENCRYPTED: &str =
        include_str!("../../../../../crates/core/tests/fixtures/keys/ed25519_encrypted");

    fn password_host(saved: Option<&str>, username: Option<&str>) -> Host {
        Host {
            username: username.map(Into::into),
            auth: HostAuth::Password {
                password: saved.map(Secret::new),
            },
            ..Host::new("10.0.0.1")
        }
    }

    fn key_host(username: Option<&str>) -> Host {
        Host {
            username: username.map(Into::into),
            auth: HostAuth::Identity {
                identity_id: Uuid::now_v7(),
            },
            ..Host::new("h")
        }
    }

    fn key(pem: &str, passphrase: Option<&str>, username: Option<&str>) -> Identity {
        Identity {
            label: "laptop key".into(),
            username: username.map(Into::into),
            password: None,
            private_key: Some(Secret::new(pem)),
            passphrase: passphrase.map(Secret::new),
            public_key: None,
            key_type: Some("ed25519".into()),
            fingerprint: None,
        }
    }

    fn typed(
        username: Option<&str>,
        password: Option<&str>,
        passphrase: Option<&str>,
    ) -> PromptedLogin {
        PromptedLogin {
            username: username.map(Into::into),
            password: password.map(Into::into),
            passphrase: passphrase.map(Into::into),
            remember: false,
        }
    }

    fn describe(plan: LoginPlan) -> String {
        match plan {
            LoginPlan::Ready {
                username,
                method,
                secret,
            } => {
                let method = match method {
                    LoginMethod::Password(p) => format!("password={p}"),
                    LoginMethod::PrivateKey { passphrase, .. } => {
                        format!("key passphrase={passphrase:?}")
                    }
                    LoginMethod::Agent { .. } => "agent".into(),
                };
                format!("ready {username} {method} from {secret:?}")
            }
            LoginPlan::NeedsPassword { username_required } => {
                format!("needs password (username {username_required})")
            }
            LoginPlan::NeedsPassphrase {
                key_label,
                username_required,
            } => {
                format!("needs passphrase for {key_label} (username {username_required})")
            }
            LoginPlan::NeedsUsername => "needs username".into(),
        }
    }

    fn plan(host: &Host, identity: Option<&Identity>, prompted: Option<&PromptedLogin>) -> String {
        describe(plan_login(host, identity, prompted).unwrap())
    }

    #[test]
    fn password_hosts() {
        assert_eq!(
            plan(&password_host(Some("pw"), Some("deploy")), None, None),
            "ready deploy password=pw from Vault"
        );
        assert_eq!(
            plan(&password_host(None, Some("deploy")), None, None),
            "needs password (username false)"
        );
        assert_eq!(
            plan(&password_host(Some("pw"), None), None, None),
            "needs password (username true)"
        );
        assert_eq!(
            plan(
                &password_host(Some("old"), Some("deploy")),
                None,
                Some(&typed(Some(" root "), Some("new"), None))
            ),
            "ready root password=new from Typed"
        );
        assert_eq!(
            plan(
                &password_host(Some("saved"), Some("deploy")),
                None,
                Some(&typed(None, Some(""), None))
            ),
            "ready deploy password=saved from Vault"
        );
    }

    #[test]
    fn agent_hosts_only_need_a_username() {
        let host = Host {
            username: Some("ops".into()),
            auth: HostAuth::Agent,
            ..Host::new("h")
        };
        assert_eq!(plan(&host, None, None), "ready ops agent from None");
        let anonymous = Host {
            auth: HostAuth::Agent,
            ..Host::new("h")
        };
        assert_eq!(plan(&anonymous, None, None), "needs username");
        assert_eq!(
            plan(&anonymous, None, Some(&typed(Some("me"), None, None))),
            "ready me agent from None"
        );
    }

    #[test]
    fn key_hosts() {
        let plain = key(ED25519, None, None);
        assert_eq!(
            plan(&key_host(Some("deploy")), Some(&plain), None),
            "ready deploy key passphrase=None from None"
        );
        assert_eq!(plan(&key_host(None), Some(&plain), None), "needs username");
        assert_eq!(
            plan(
                &key_host(None),
                Some(&key(ED25519, None, Some("git"))),
                None
            ),
            "ready git key passphrase=None from None"
        );
    }

    #[test]
    fn encrypted_keys_ask_for_the_passphrase_unless_saved_or_typed() {
        let locked = key(ENCRYPTED, None, None);
        assert_eq!(
            plan(&key_host(Some("deploy")), Some(&locked), None),
            "needs passphrase for laptop key (username false)"
        );
        assert_eq!(
            plan(&key_host(None), Some(&locked), None),
            "needs passphrase for laptop key (username true)"
        );
        assert_eq!(
            plan(
                &key_host(Some("deploy")),
                Some(&locked),
                Some(&typed(None, None, Some("pp")))
            ),
            "ready deploy key passphrase=Some(\"pp\") from Typed"
        );
        let saved = key(ENCRYPTED, Some("pp"), None);
        assert_eq!(
            plan(&key_host(Some("deploy")), Some(&saved), None),
            "ready deploy key passphrase=Some(\"pp\") from Vault"
        );
    }

    #[test]
    fn password_only_identity_behaves_like_a_password_host() {
        let identity = Identity::with_password("ops", "ops", "idpw");
        assert_eq!(
            plan(&key_host(None), Some(&identity), None),
            "ready ops password=idpw from Vault"
        );
    }

    #[test]
    fn reports_unusable_configurations() {
        let cases: [(Host, Option<&Identity>, &str); 2] = [
            (key_host(Some("u")), None, "no longer exists"),
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
        let cases = [
            (
                OpenHostOutcome::NeedsPassphrase {
                    key_label: "k".into(),
                    wrong_passphrase: true,
                    username_required: false,
                },
                serde_json::json!({"status":"needsPassphrase","keyLabel":"k","wrongPassphrase":true,"usernameRequired":false}),
            ),
            (
                OpenHostOutcome::NeedsUsername,
                serde_json::json!({"status":"needsUsername"}),
            ),
            (
                OpenHostOutcome::HostKeyChanged {
                    algorithm: "a".into(),
                    fingerprint: "n".into(),
                    previous_fingerprint: "o".into(),
                },
                serde_json::json!({"status":"hostKeyChanged","algorithm":"a","fingerprint":"n","previousFingerprint":"o"}),
            ),
        ];
        for (outcome, json) in cases {
            assert_eq!(serde_json::to_value(outcome).unwrap(), json);
        }
    }

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn remembers_a_typed_password_and_username_on_the_host() {
        let vault = vault().await;
        let host = password_host(None, None);
        let id = vault.hosts().create(&host).await.unwrap().meta.id;
        let mut prompted = typed(Some("deploy"), Some("pw"), None);
        prompted.remember = true;

        remember_typed_secrets(
            &vault,
            id,
            &host,
            None,
            &prompted,
            "deploy",
            SecretSource::Typed,
        )
        .await
        .unwrap();

        let saved = vault.hosts().get(id).await.unwrap().unwrap().payload;
        assert_eq!(saved.username.as_deref(), Some("deploy"));
        assert!(
            matches!(saved.auth, HostAuth::Password { password: Some(ref p) } if p.expose() == "pw")
        );
    }

    #[tokio::test]
    async fn remembers_a_typed_passphrase_on_the_key() {
        let vault = vault().await;
        let identity = vault
            .identities()
            .create(&key(ENCRYPTED, None, None))
            .await
            .unwrap();
        let host = Host {
            username: Some("deploy".into()),
            auth: HostAuth::Identity {
                identity_id: identity.meta.id,
            },
            ..Host::new("h")
        };
        let host_id = vault.hosts().create(&host).await.unwrap().meta.id;
        let prompted = PromptedLogin {
            passphrase: Some("test-passphrase".into()),
            remember: true,
            ..Default::default()
        };

        remember_typed_secrets(
            &vault,
            host_id,
            &host,
            Some(&identity),
            &prompted,
            "deploy",
            SecretSource::Typed,
        )
        .await
        .unwrap();

        let saved = vault
            .identities()
            .get(identity.meta.id)
            .await
            .unwrap()
            .unwrap()
            .payload;
        assert_eq!(
            saved.passphrase.as_ref().map(Secret::expose),
            Some("test-passphrase")
        );
        assert_eq!(
            vault
                .hosts()
                .get(host_id)
                .await
                .unwrap()
                .unwrap()
                .meta
                .revision,
            1,
            "host unchanged"
        );
    }
}

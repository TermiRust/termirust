use serde::{Deserialize, Serialize};
use tauri::State;
use termirust_core::CoreError;
use termirust_core::vault::{
    Group, GroupRecord, Host, HostAuth, HostEnvironment, HostRecord, Secret,
};
use uuid::Uuid;

use crate::command_error::CommandError;
use crate::vault_state::VaultState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum EnvironmentView {
    Production,
    Staging,
    Development,
}

impl From<HostEnvironment> for EnvironmentView {
    fn from(env: HostEnvironment) -> Self {
        match env {
            HostEnvironment::Production => Self::Production,
            HostEnvironment::Staging => Self::Staging,
            HostEnvironment::Development => Self::Development,
        }
    }
}

impl From<EnvironmentView> for HostEnvironment {
    fn from(env: EnvironmentView) -> Self {
        match env {
            EnvironmentView::Production => Self::Production,
            EnvironmentView::Staging => Self::Staging,
            EnvironmentView::Development => Self::Development,
        }
    }
}

/// What the UI may know about a host. Saved passwords never leave Rust.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostView {
    pub id: String,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: Option<String>,
    pub auth: AuthView,
    pub group_id: Option<String>,
    pub jump_host_id: Option<String>,
    pub tags: Vec<String>,
    pub notes: String,
    pub keepalive_secs: Option<u32>,
    pub color: Option<String>,
    pub ai_disabled: bool,
    pub os: Option<String>,
    pub environment: Option<EnvironmentView>,
    pub proxy_command: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum AuthView {
    #[serde(rename_all = "camelCase")]
    Password {
        has_saved_password: bool,
    },
    #[serde(rename_all = "camelCase")]
    Identity {
        identity_id: String,
    },
    Agent,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostInput {
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: Option<String>,
    pub auth: AuthInput,
    pub group_id: Option<String>,
    pub jump_host_id: Option<String>,
    pub tags: Vec<String>,
    pub notes: String,
    pub keepalive_secs: Option<u32>,
    pub color: Option<String>,
    pub ai_disabled: bool,
    pub environment: Option<EnvironmentView>,
    /// OpenSSH ProxyCommand; empty means none.
    #[serde(default)]
    pub proxy_command: Option<String>,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum AuthInput {
    #[serde(rename_all = "camelCase")]
    Password {
        password: PasswordChange,
    },
    #[serde(rename_all = "camelCase")]
    Identity {
        identity_id: String,
    },
    Agent,
}

/// Editing a host must not require re-typing a saved password the UI never sees.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum PasswordChange {
    Keep,
    Clear,
    Set(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupView {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub warning_border: bool,
    pub ai_disabled: bool,
}

pub(crate) fn parse_id(value: &str) -> Result<Uuid, CommandError> {
    Uuid::parse_str(value)
        .map_err(|_| CoreError::InvalidData(format!("invalid id: {value}")).into())
}

fn parse_optional_id(value: Option<&String>) -> Result<Option<Uuid>, CommandError> {
    value
        .filter(|v| !v.is_empty())
        .map(|v| parse_id(v))
        .transpose()
}

impl From<&HostRecord> for HostView {
    fn from(record: &HostRecord) -> Self {
        let host = &record.payload;
        Self {
            id: record.meta.id.to_string(),
            label: host.label.clone(),
            hostname: host.hostname.clone(),
            port: host.port,
            username: host.username.clone(),
            auth: match &host.auth {
                HostAuth::Password { password } => AuthView::Password {
                    has_saved_password: password.is_some(),
                },
                HostAuth::Identity { identity_id } => AuthView::Identity {
                    identity_id: identity_id.to_string(),
                },
                HostAuth::Agent => AuthView::Agent,
            },
            group_id: host.group_id.map(|id| id.to_string()),
            jump_host_id: host.jump_host_id.map(|id| id.to_string()),
            tags: host.tags.clone(),
            notes: host.notes.clone(),
            keepalive_secs: host.keepalive_secs,
            color: host.color.clone(),
            ai_disabled: host.ai_disabled,
            os: host.os.clone(),
            environment: host.environment.map(Into::into),
            proxy_command: host.proxy_command.clone(),
        }
    }
}

impl From<&GroupRecord> for GroupView {
    fn from(record: &GroupRecord) -> Self {
        Self {
            id: record.meta.id.to_string(),
            name: record.payload.name.clone(),
            parent_id: record.payload.parent_id.map(|id| id.to_string()),
            color: record.payload.color.clone(),
            warning_border: record.payload.warning_border,
            ai_disabled: record.payload.ai_disabled,
        }
    }
}

/// Builds the stored host; `previous` supplies the saved password when the input says Keep.
fn host_from_input(input: HostInput, previous: Option<&Host>) -> Result<Host, CommandError> {
    let auth = match input.auth {
        AuthInput::Password { password } => HostAuth::Password {
            password: match password {
                PasswordChange::Set(value) if !value.is_empty() => Some(Secret::new(value)),
                PasswordChange::Set(_) | PasswordChange::Clear => None,
                PasswordChange::Keep => match previous.map(|h| &h.auth) {
                    Some(HostAuth::Password { password }) => password.clone(),
                    _ => None,
                },
            },
        },
        AuthInput::Identity { identity_id } => HostAuth::Identity {
            identity_id: parse_id(&identity_id)?,
        },
        AuthInput::Agent => HostAuth::Agent,
    };
    Ok(Host {
        label: input.label,
        hostname: input.hostname,
        port: input.port,
        username: input.username,
        auth,
        group_id: parse_optional_id(input.group_id.as_ref())?,
        jump_host_id: parse_optional_id(input.jump_host_id.as_ref())?,
        tags: input.tags,
        notes: input.notes,
        keepalive_secs: input.keepalive_secs,
        color: input.color.filter(|c| !c.is_empty()),
        ai_disabled: input.ai_disabled,
        // Detected, not typed: editing a host must not forget it.
        os: previous.and_then(|h| h.os.clone()),
        environment: input.environment.map(Into::into),
        proxy_command: input
            .proxy_command
            .map(|c| c.trim().to_owned())
            .filter(|c| !c.is_empty()),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn hosts_list(state: State<'_, VaultState>) -> Result<Vec<HostView>, CommandError> {
    let hosts = state.vault().await?.hosts().list().await?;
    Ok(hosts.iter().map(HostView::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn hosts_create(
    state: State<'_, VaultState>,
    input: HostInput,
) -> Result<HostView, CommandError> {
    let host = host_from_input(input, None)?;
    let record = state.vault().await?.hosts().create(&host).await?;
    Ok(HostView::from(&record))
}

#[tauri::command]
#[specta::specta]
pub async fn hosts_update(
    state: State<'_, VaultState>,
    id: String,
    input: HostInput,
) -> Result<HostView, CommandError> {
    let id = parse_id(&id)?;
    let vault = state.vault().await?;
    let hosts = vault.hosts();
    let previous = hosts.get(id).await?.ok_or_else(|| CoreError::NotFound {
        kind: "host",
        id: id.to_string(),
    })?;
    let host = host_from_input(input, Some(&previous.payload))?;
    let record = hosts.update(id, &host).await?;
    Ok(HostView::from(&record))
}

/// Moves a host into a group, or out of every group with `None`. Nothing else changes.
#[tauri::command]
#[specta::specta]
pub async fn hosts_move(
    state: State<'_, VaultState>,
    id: String,
    group_id: Option<String>,
) -> Result<HostView, CommandError> {
    let vault = state.vault().await?;
    move_host(
        &vault,
        parse_id(&id)?,
        parse_optional_id(group_id.as_ref())?,
    )
    .await
}

async fn move_host(
    vault: &termirust_core::vault::Vault,
    id: Uuid,
    group_id: Option<Uuid>,
) -> Result<HostView, CommandError> {
    let hosts = vault.hosts();
    let mut host = hosts
        .get(id)
        .await?
        .ok_or_else(|| CoreError::NotFound {
            kind: "host",
            id: id.to_string(),
        })?
        .payload;
    host.group_id = group_id;
    Ok(HostView::from(&hosts.update(id, &host).await?))
}

#[tauri::command]
#[specta::specta]
pub async fn hosts_delete(state: State<'_, VaultState>, id: String) -> Result<(), CommandError> {
    state
        .vault()
        .await?
        .hosts()
        .delete(parse_id(&id)?)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn groups_list(state: State<'_, VaultState>) -> Result<Vec<GroupView>, CommandError> {
    let groups = state.vault().await?.groups().list().await?;
    Ok(groups.iter().map(GroupView::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn groups_create(
    state: State<'_, VaultState>,
    name: String,
    parent_id: Option<String>,
) -> Result<GroupView, CommandError> {
    let group = Group {
        parent_id: parse_optional_id(parent_id.as_ref())?,
        ..Group::new(name)
    };
    let record = state.vault().await?.groups().create(&group).await?;
    Ok(GroupView::from(&record))
}

#[tauri::command]
#[specta::specta]
pub async fn groups_update(
    state: State<'_, VaultState>,
    id: String,
    name: String,
    color: Option<String>,
    warning_border: bool,
    ai_disabled: bool,
) -> Result<GroupView, CommandError> {
    let id = parse_id(&id)?;
    let vault = state.vault().await?;
    let groups = vault.groups();
    let current = groups
        .get(id)
        .await?
        .ok_or_else(|| CoreError::NotFound {
            kind: "group",
            id: id.to_string(),
        })?
        .payload;
    let updated = Group {
        name,
        color: color.filter(|c| !c.is_empty()),
        warning_border,
        ai_disabled,
        ..current
    };
    let record = groups.update(id, &updated).await?;
    Ok(GroupView::from(&record))
}

#[tauri::command]
#[specta::specta]
pub async fn groups_delete(state: State<'_, VaultState>, id: String) -> Result<(), CommandError> {
    state
        .vault()
        .await?
        .groups()
        .delete(parse_id(&id)?)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use termirust_core::storage::Database;
    use termirust_core::vault::{MemoryKeyStore, Vault};

    use super::*;
    use crate::command_error::CommandErrorCode;

    fn input(auth: AuthInput) -> HostInput {
        HostInput {
            label: "prod".into(),
            hostname: "10.0.0.1".into(),
            port: 22,
            username: Some("deploy".into()),
            auth,
            group_id: None,
            jump_host_id: None,
            tags: vec!["prod".into()],
            notes: String::new(),
            keepalive_secs: None,
            color: None,
            ai_disabled: false,
            environment: None,
            proxy_command: None,
        }
    }

    #[test]
    fn stores_a_trimmed_proxy_command_and_drops_a_blank_one() {
        let with = HostInput {
            proxy_command: Some("  cloudflared access ssh --hostname %h ".into()),
            ..input(AuthInput::Agent)
        };
        assert_eq!(
            host_from_input(with, None)
                .unwrap()
                .proxy_command
                .as_deref(),
            Some("cloudflared access ssh --hostname %h")
        );
        let blank = HostInput {
            proxy_command: Some("   ".into()),
            ..input(AuthInput::Agent)
        };
        assert_eq!(host_from_input(blank, None).unwrap().proxy_command, None);
    }

    #[tokio::test]
    async fn moving_a_host_changes_only_its_group() {
        let db = Database::open_in_memory().await.unwrap();
        let vault = Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap();
        let group = vault
            .groups()
            .create(&Group::new("prod"))
            .await
            .unwrap()
            .meta
            .id;
        let saved = vault
            .hosts()
            .create(&Host {
                auth: HostAuth::Password {
                    password: Some(Secret::new("pw")),
                },
                ..Host::new("db")
            })
            .await
            .unwrap();

        let moved = move_host(&vault, saved.meta.id, Some(group)).await.unwrap();
        assert_eq!(moved.group_id, Some(group.to_string()));
        let stored = vault
            .hosts()
            .get(saved.meta.id)
            .await
            .unwrap()
            .unwrap()
            .payload;
        assert_eq!(saved_password(&stored).as_deref(), Some("pw"));

        let out = move_host(&vault, saved.meta.id, None).await.unwrap();
        assert_eq!(out.group_id, None);
        assert!(
            move_host(&vault, saved.meta.id, Some(Uuid::now_v7()))
                .await
                .is_err(),
            "the group must exist"
        );
    }

    #[test]
    fn editing_a_host_keeps_its_detected_os() {
        let previous = Host {
            os: Some("ubuntu".into()),
            ..Host::new("10.0.0.1")
        };
        let edited = host_from_input(input(AuthInput::Agent), Some(&previous)).unwrap();
        assert_eq!(edited.os.as_deref(), Some("ubuntu"));
        assert_eq!(
            host_from_input(input(AuthInput::Agent), None).unwrap().os,
            None
        );
    }

    #[test]
    fn carries_the_ai_switch_both_ways() {
        let host = host_from_input(
            HostInput {
                ai_disabled: true,
                ..input(AuthInput::Agent)
            },
            None,
        )
        .unwrap();
        assert!(host.ai_disabled);
        let record = termirust_core::vault::StoredItem {
            meta: termirust_core::vault::ItemMeta {
                id: Uuid::now_v7(),
                revision: 1,
                created_at: 0,
                updated_at: 0,
            },
            payload: host,
        };
        assert!(HostView::from(&record).ai_disabled);
    }

    fn password(change: PasswordChange) -> AuthInput {
        AuthInput::Password { password: change }
    }

    fn saved_password(host: &Host) -> Option<String> {
        match &host.auth {
            HostAuth::Password { password } => password.as_ref().map(|p| p.expose().to_owned()),
            _ => None,
        }
    }

    #[test]
    fn view_reports_a_saved_password_without_revealing_it() {
        let host =
            host_from_input(input(password(PasswordChange::Set("hunter2".into()))), None).unwrap();
        let record = HostRecord {
            meta: termirust_core::vault::ItemMeta {
                id: Uuid::now_v7(),
                revision: 1,
                created_at: 0,
                updated_at: 0,
            },
            payload: host,
        };
        let view = HostView::from(&record);
        assert_eq!(
            view.auth,
            AuthView::Password {
                has_saved_password: true
            }
        );
        assert!(!serde_json::to_string(&view).unwrap().contains("hunter2"));
    }

    #[test]
    fn keep_preserves_the_previous_password_and_clear_or_empty_removes_it() {
        let previous =
            host_from_input(input(password(PasswordChange::Set("old".into()))), None).unwrap();

        let kept = host_from_input(input(password(PasswordChange::Keep)), Some(&previous)).unwrap();
        assert_eq!(saved_password(&kept).as_deref(), Some("old"));

        let cleared =
            host_from_input(input(password(PasswordChange::Clear)), Some(&previous)).unwrap();
        assert_eq!(saved_password(&cleared), None);

        let empty = host_from_input(
            input(password(PasswordChange::Set(String::new()))),
            Some(&previous),
        )
        .unwrap();
        assert_eq!(saved_password(&empty), None);

        let replaced = host_from_input(
            input(password(PasswordChange::Set("new".into()))),
            Some(&previous),
        )
        .unwrap();
        assert_eq!(saved_password(&replaced).as_deref(), Some("new"));
    }

    #[test]
    fn keep_after_switching_from_agent_saves_nothing() {
        let previous = host_from_input(input(AuthInput::Agent), None).unwrap();
        let host = host_from_input(input(password(PasswordChange::Keep)), Some(&previous)).unwrap();
        assert_eq!(saved_password(&host), None);
    }

    #[test]
    fn rejects_malformed_ids_and_treats_empty_ids_as_none() {
        let mut bad = input(AuthInput::Agent);
        bad.group_id = Some("not-a-uuid".into());
        let err = host_from_input(bad, None).unwrap_err();
        assert_eq!(err.code, CommandErrorCode::InvalidData);

        let mut empty = input(AuthInput::Agent);
        empty.group_id = Some(String::new());
        assert_eq!(host_from_input(empty, None).unwrap().group_id, None);
    }

    #[test]
    fn input_json_from_the_frontend_is_accepted() {
        let json = r#"{"label":"a","hostname":"h","port":22,"username":null,
            "auth":{"method":"password","password":{"kind":"set","value":"pw"}},
            "groupId":null,"jumpHostId":null,"tags":[],"notes":"","keepaliveSecs":30,"color":"teal","aiDisabled":false,"environment":"production"}"#;
        let parsed: HostInput = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.environment, Some(EnvironmentView::Production));
        assert!(
            matches!(parsed.auth, AuthInput::Password { password: PasswordChange::Set(ref v) } if v == "pw")
        );

        let keep: PasswordChange = serde_json::from_str(r#"{"kind":"keep"}"#).unwrap();
        assert!(matches!(keep, PasswordChange::Keep));
        assert_eq!(parsed.color.as_deref(), Some("teal"));
    }

    #[tokio::test]
    async fn round_trip_through_the_vault() {
        let db = Database::open_in_memory().await.unwrap();
        let vault = Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap();
        let host =
            host_from_input(input(password(PasswordChange::Set("pw".into()))), None).unwrap();
        let record = vault.hosts().create(&host).await.unwrap();

        let view = HostView::from(&vault.hosts().get(record.meta.id).await.unwrap().unwrap());
        assert_eq!(view.hostname, "10.0.0.1");
        assert_eq!(view.tags, ["prod"]);
    }
}

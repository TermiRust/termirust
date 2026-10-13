use serde::Serialize;
use tauri::State;
use termirust_core::CoreError;
use termirust_core::ssh::{KeyInfo, generate_ed25519, inspect_private_key};
use termirust_core::vault::{HostAuth, Identity, IdentityRecord, Secret};
use uuid::Uuid;

use crate::command_error::CommandError;
use crate::vault_state::VaultState;

/// A private key in the Keychain as the UI sees it; the private half never leaves Rust.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyView {
    pub id: String,
    pub label: String,
    pub key_type: String,
    pub fingerprint: String,
    pub public_key: String,
    pub encrypted: bool,
    pub has_saved_passphrase: bool,
    /// Labels of hosts that log in with this key.
    pub used_by: Vec<String>,
}

/// `ssh-ed25519` → `ed25519`, `ecdsa-sha2-nistp256` → `ecdsa`, `ssh-rsa` → `rsa`.
fn short_key_type(algorithm: &str) -> String {
    let name = algorithm.strip_prefix("ssh-").unwrap_or(algorithm);
    name.split('-').next().unwrap_or(name).to_owned()
}

fn key_view(record: &IdentityRecord, used_by: Vec<String>) -> Option<KeyView> {
    let identity = &record.payload;
    identity.private_key.as_ref()?;
    Some(KeyView {
        id: record.meta.id.to_string(),
        label: identity.label.clone(),
        key_type: identity.key_type.clone().unwrap_or_default(),
        fingerprint: identity.fingerprint.clone().unwrap_or_default(),
        public_key: identity.public_key.clone().unwrap_or_default(),
        encrypted: is_encrypted(identity),
        has_saved_passphrase: identity.passphrase.is_some(),
        used_by,
    })
}

fn is_encrypted(identity: &Identity) -> bool {
    identity
        .private_key
        .as_ref()
        .and_then(|pem| inspect_private_key(pem.expose(), None).ok())
        .is_some_and(|info| info.encrypted)
}

fn key_identity(
    label: String,
    pem: String,
    info: &KeyInfo,
    passphrase: Option<String>,
) -> Identity {
    Identity {
        label,
        username: None,
        password: None,
        private_key: Some(Secret::new(pem)),
        passphrase: passphrase.filter(|p| !p.is_empty()).map(Secret::new),
        public_key: Some(info.public_key.clone()),
        key_type: Some(short_key_type(&info.algorithm)),
        fingerprint: Some(info.fingerprint.clone()),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn keys_list(state: State<'_, VaultState>) -> Result<Vec<KeyView>, CommandError> {
    let vault = state.vault().await?;
    let hosts = vault.hosts().list().await?;
    let identities = vault.identities().list().await?;
    Ok(identities
        .iter()
        .filter_map(|record| {
            let used_by = hosts
                .iter()
                .filter(|h| matches!(h.payload.auth, HostAuth::Identity { identity_id } if identity_id == record.meta.id))
                .map(|h| h.payload.label.clone())
                .collect();
            key_view(record, used_by)
        })
        .collect())
}

/// Imports pasted key text. A passphrase, if given, is verified; it is stored only when asked.
#[tauri::command]
#[specta::specta]
pub async fn keys_import(
    state: State<'_, VaultState>,
    label: String,
    private_key: String,
    passphrase: Option<String>,
    remember_passphrase: bool,
) -> Result<KeyView, CommandError> {
    let pem = private_key.trim().to_owned() + "\n";
    let info = inspect_private_key(&pem, passphrase.as_deref())?;
    let saved_passphrase = if remember_passphrase {
        passphrase
    } else {
        None
    };
    let record = state
        .vault()
        .await?
        .identities()
        .create(&key_identity(label, pem, &info, saved_passphrase))
        .await?;
    key_view(&record, Vec::new())
        .ok_or_else(|| CoreError::InvalidData("imported key has no private part".into()).into())
}

#[tauri::command]
#[specta::specta]
pub async fn keys_import_file(
    state: State<'_, VaultState>,
    label: String,
    path: String,
    passphrase: Option<String>,
    remember_passphrase: bool,
) -> Result<KeyView, CommandError> {
    let text = std::fs::read_to_string(&path)
        .map_err(|e| CoreError::InvalidData(format!("cannot read {path}: {e}")))?;
    let label = if label.trim().is_empty() {
        std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    } else {
        label
    };
    keys_import(state, label, text, passphrase, remember_passphrase).await
}

#[tauri::command]
#[specta::specta]
pub async fn keys_generate(
    state: State<'_, VaultState>,
    label: String,
) -> Result<KeyView, CommandError> {
    let label = if label.trim().is_empty() {
        "termirust".to_owned()
    } else {
        label.trim().to_owned()
    };
    let generated = generate_ed25519(&label)?;
    let identity = key_identity(label, generated.private_key.clone(), &generated.info, None);
    let record = state.vault().await?.identities().create(&identity).await?;
    key_view(&record, Vec::new())
        .ok_or_else(|| CoreError::InvalidData("generated key has no private part".into()).into())
}

#[tauri::command]
#[specta::specta]
pub async fn keys_delete(state: State<'_, VaultState>, id: String) -> Result<(), CommandError> {
    let id =
        Uuid::parse_str(&id).map_err(|_| CoreError::InvalidData(format!("invalid id: {id}")))?;
    state
        .vault()
        .await?
        .identities()
        .delete(id)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use termirust_core::storage::Database;
    use termirust_core::vault::{MemoryKeyStore, Vault};

    use super::*;

    const ED25519: &str = include_str!("../../../../../crates/core/tests/fixtures/keys/ed25519");
    const ENCRYPTED: &str =
        include_str!("../../../../../crates/core/tests/fixtures/keys/ed25519_encrypted");

    #[test]
    fn shortens_algorithm_names() {
        assert_eq!(short_key_type("ssh-ed25519"), "ed25519");
        assert_eq!(short_key_type("ecdsa-sha2-nistp256"), "ecdsa");
        assert_eq!(short_key_type("ssh-rsa"), "rsa");
    }

    #[tokio::test]
    async fn view_exposes_public_facts_only() {
        let db = Database::open_in_memory().await.unwrap();
        let vault = Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap();
        let info = inspect_private_key(ED25519, None).unwrap();
        let record = vault
            .identities()
            .create(&key_identity("laptop".into(), ED25519.into(), &info, None))
            .await
            .unwrap();

        let view = key_view(&record, vec!["prod".into()]).unwrap();
        assert_eq!(view.key_type, "ed25519");
        assert_eq!(
            view.fingerprint,
            "SHA256:NkmZjAZ5a2Iai06/4rqvzAM4Ckxj7TUhIIRon4FXeX0"
        );
        assert!(view.public_key.starts_with("ssh-ed25519 "));
        assert!(!view.encrypted);
        assert_eq!(view.used_by, ["prod"]);
        assert!(
            !serde_json::to_string(&view)
                .unwrap()
                .contains("PRIVATE KEY")
        );
    }

    #[tokio::test]
    async fn encrypted_keys_are_flagged_and_passphrase_storage_is_opt_in() {
        let db = Database::open_in_memory().await.unwrap();
        let vault = Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap();
        let info = inspect_private_key(ENCRYPTED, Some("test-passphrase")).unwrap();

        let forgotten = vault
            .identities()
            .create(&key_identity("a".into(), ENCRYPTED.into(), &info, None))
            .await
            .unwrap();
        let view = key_view(&forgotten, vec![]).unwrap();
        assert!(view.encrypted);
        assert!(!view.has_saved_passphrase);

        let remembered = vault
            .identities()
            .create(&key_identity(
                "b".into(),
                ENCRYPTED.into(),
                &info,
                Some("test-passphrase".into()),
            ))
            .await
            .unwrap();
        assert!(key_view(&remembered, vec![]).unwrap().has_saved_passphrase);
    }

    #[tokio::test]
    async fn password_only_identities_are_not_listed_as_keys() {
        let db = Database::open_in_memory().await.unwrap();
        let vault = Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap();
        let record = vault
            .identities()
            .create(&Identity::with_password("ops", "ops", "pw"))
            .await
            .unwrap();
        assert!(key_view(&record, vec![]).is_none());
    }
}

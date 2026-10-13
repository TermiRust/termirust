use std::path::Path;

use termirust_core::storage::{DATABASE_FILE_NAME, Database};
use termirust_core::vault::{Vault, VaultKeyStore};

use crate::command_error::CommandError;

pub const KEYCHAIN_SERVICE: &str = "dev.termirust.app";

/// The vault opened at startup, or why it could not be opened. The app still starts on
/// failure so the UI can explain the problem instead of crashing.
pub struct VaultState(Result<Vault, CommandError>);

impl VaultState {
    pub async fn open(data_dir: &Path, key_store: &dyn VaultKeyStore) -> Self {
        let opened = async {
            let db = Database::open(&data_dir.join(DATABASE_FILE_NAME)).await?;
            Vault::open_or_create(db, key_store).await
        }
        .await;
        match &opened {
            Ok(vault) => tracing::info!(vault_id = vault.vault_id(), "vault opened"),
            Err(e) => tracing::error!(error = %e, "vault could not be opened"),
        }
        Self(opened.map_err(CommandError::from))
    }

    pub fn vault(&self) -> Result<&Vault, CommandError> {
        self.0.as_ref().map_err(Clone::clone)
    }
}

#[cfg(test)]
mod tests {
    use termirust_core::vault::MemoryKeyStore;
    use termirust_core::vault::crypto::VaultKey;

    use super::*;
    use crate::command_error::CommandErrorCode;

    #[tokio::test]
    async fn creates_the_database_inside_the_app_data_directory() {
        let dir = tempfile::tempdir().unwrap();
        let state = VaultState::open(dir.path(), &MemoryKeyStore::default()).await;

        assert!(state.vault().is_ok());
        assert!(dir.path().join(DATABASE_FILE_NAME).exists());
    }

    struct BrokenKeychain;
    impl VaultKeyStore for BrokenKeychain {
        fn load(&self, _: &str) -> termirust_core::Result<Option<VaultKey>> {
            Err(termirust_core::CoreError::Keychain(
                "no secret service".into(),
            ))
        }
        fn save(&self, _: &str, _: &VaultKey) -> termirust_core::Result<()> {
            Err(termirust_core::CoreError::Keychain(
                "no secret service".into(),
            ))
        }
    }

    #[tokio::test]
    async fn keeps_the_failure_for_the_ui_instead_of_panicking() {
        let dir = tempfile::tempdir().unwrap();
        let state = VaultState::open(dir.path(), &BrokenKeychain).await;

        let err = state.vault().err().expect("opening must fail");
        assert_eq!(err.code, CommandErrorCode::Keychain);
        assert!(err.message.contains("no secret service"));
    }
}

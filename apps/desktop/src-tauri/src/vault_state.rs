use std::path::{Path, PathBuf};
use std::sync::Arc;

use termirust_core::storage::{DATABASE_FILE_NAME, Database};
use termirust_core::vault::{Vault, VaultKeyStore};
use tokio::sync::watch;

use crate::command_error::CommandError;

pub const KEYCHAIN_SERVICE: &str = "dev.termirust.app";

#[derive(Clone)]
enum Slot {
    Opening,
    Ready(Vault),
    Failed(CommandError),
}

/// The vault, opened in the background so the window can appear while the OS keychain
/// is still asking for permission. Commands wait for it instead of failing early.
pub struct VaultState {
    slot: watch::Sender<Slot>,
    data_dir: PathBuf,
    key_store: Arc<dyn VaultKeyStore>,
}

/// No vault database yet: the user has not seen the onboarding, so nothing may touch the
/// OS keychain (whose permission prompt would otherwise appear unexplained).
pub fn is_first_launch(data_dir: &Path) -> bool {
    !data_dir.join(DATABASE_FILE_NAME).exists()
}

pub async fn open_vault(
    data_dir: &Path,
    key_store: &dyn VaultKeyStore,
) -> Result<Vault, CommandError> {
    let opened = async {
        let db = Database::open(&data_dir.join(DATABASE_FILE_NAME)).await?;
        Vault::open_or_create(db, key_store).await
    }
    .await;
    match &opened {
        Ok(vault) => tracing::info!(vault_id = vault.vault_id(), "vault opened"),
        Err(e) => tracing::error!(error = %e, "vault could not be opened"),
    }
    opened.map_err(CommandError::from)
}

impl VaultState {
    pub fn new(data_dir: PathBuf, key_store: Arc<dyn VaultKeyStore>) -> Self {
        Self {
            slot: watch::Sender::new(Slot::Opening),
            data_dir,
            key_store,
        }
    }

    /// Opens (or re-opens after a failure) and publishes the result to waiting commands.
    pub async fn open(&self) {
        self.slot.send_replace(Slot::Opening);
        let result = open_vault(&self.data_dir, self.key_store.as_ref()).await;
        self.slot.send_replace(match result {
            Ok(vault) => Slot::Ready(vault),
            Err(e) => Slot::Failed(e),
        });
    }

    /// Waits while the vault is opening, then returns it or why it could not be opened.
    pub async fn vault(&self) -> Result<Vault, CommandError> {
        let mut receiver = self.slot.subscribe();
        let slot = receiver
            .wait_for(|s| !matches!(s, Slot::Opening))
            .await
            .map(|s| s.clone())
            .unwrap_or_else(|_| {
                Slot::Failed(
                    termirust_core::CoreError::Storage("vault state dropped".into()).into(),
                )
            });
        match slot {
            Slot::Ready(vault) => Ok(vault),
            Slot::Failed(e) => Err(e),
            Slot::Opening => unreachable!("wait_for only returns once opening has finished"),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use termirust_core::vault::MemoryKeyStore;
    use termirust_core::vault::crypto::VaultKey;

    use super::*;
    use crate::command_error::CommandErrorCode;

    #[tokio::test]
    async fn first_launch_is_detected_until_the_vault_has_been_created() {
        let dir = tempfile::tempdir().unwrap();
        assert!(is_first_launch(dir.path()));
        let state = VaultState::new(
            dir.path().to_path_buf(),
            Arc::new(MemoryKeyStore::default()),
        );
        state.open().await;
        assert!(!is_first_launch(dir.path()));
    }

    #[tokio::test]
    async fn creates_the_database_inside_the_app_data_directory() {
        let dir = tempfile::tempdir().unwrap();
        let state = VaultState::new(
            dir.path().to_path_buf(),
            Arc::new(MemoryKeyStore::default()),
        );
        state.open().await;

        assert!(state.vault().await.is_ok());
        assert!(dir.path().join(DATABASE_FILE_NAME).exists());
    }

    #[tokio::test]
    async fn commands_wait_for_a_vault_that_is_still_opening() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(VaultState::new(
            dir.path().to_path_buf(),
            Arc::new(MemoryKeyStore::default()),
        ));

        let waiting = tokio::spawn({
            let state = state.clone();
            async move { state.vault().await.map(|v| v.vault_id().to_owned()) }
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!waiting.is_finished(), "must wait while opening");

        state.open().await;
        assert!(waiting.await.unwrap().is_ok());
    }

    /// Fails until `unlocked` is set, like a keychain the user first denies, then allows.
    struct FlakyKeychain {
        unlocked: AtomicBool,
        inner: MemoryKeyStore,
    }
    impl VaultKeyStore for FlakyKeychain {
        fn load(&self, id: &str) -> termirust_core::Result<Option<VaultKey>> {
            if !self.unlocked.load(Ordering::SeqCst) {
                return Err(termirust_core::CoreError::Keychain("access denied".into()));
            }
            self.inner.load(id)
        }
        fn save(&self, id: &str, key: &VaultKey) -> termirust_core::Result<()> {
            if !self.unlocked.load(Ordering::SeqCst) {
                return Err(termirust_core::CoreError::Keychain("access denied".into()));
            }
            self.inner.save(id, key)
        }
    }

    #[tokio::test]
    async fn keeps_the_failure_for_the_ui_and_can_try_again() {
        let dir = tempfile::tempdir().unwrap();
        let keychain = Arc::new(FlakyKeychain {
            unlocked: AtomicBool::new(false),
            inner: MemoryKeyStore::default(),
        });
        let state = VaultState::new(dir.path().to_path_buf(), keychain.clone());

        state.open().await;
        let err = state.vault().await.err().expect("opening must fail");
        assert_eq!(err.code, CommandErrorCode::Keychain);
        assert!(err.message.contains("access denied"));

        keychain.unlocked.store(true, Ordering::SeqCst);
        state.open().await;
        assert!(state.vault().await.is_ok());
    }
}

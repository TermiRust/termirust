use std::sync::Arc;

use super::crypto::{self, VaultKey};
use super::key_store::VaultKeyStore;
use crate::storage::Database;
use crate::{CoreError, Result};

pub const VAULT_FORMAT_VERSION: i64 = 1;
const KEY_CHECK_PLAINTEXT: &[u8] = b"termirust-key-check";
const KEY_CHECK_AAD: &[u8] = b"termirust:v1:key-check";

/// An unlocked vault: the database plus the key that decrypts its items.
#[derive(Clone)]
pub struct Vault {
    pub(super) db: Database,
    pub(super) key: Arc<VaultKey>,
    vault_id: String,
}

impl Vault {
    /// Opens the vault, creating it on first launch with a fresh random key in `key_store`.
    pub async fn open_or_create(db: Database, key_store: &dyn VaultKeyStore) -> Result<Self> {
        let existing: Option<(String, Vec<u8>)> =
            sqlx::query_as("SELECT vault_id, key_check FROM vault_meta WHERE id = 1")
                .fetch_optional(db.pool())
                .await?;

        match existing {
            Some((vault_id, key_check)) => {
                let key = key_store
                    .load(&vault_id)?
                    .ok_or(CoreError::VaultKeyMissing)?;
                verify_key_check(&key, &key_check)?;
                Ok(Self {
                    db,
                    key: Arc::new(key),
                    vault_id,
                })
            }
            None => Self::create(db, key_store).await,
        }
    }

    async fn create(db: Database, key_store: &dyn VaultKeyStore) -> Result<Self> {
        let vault_id = uuid::Uuid::now_v7().to_string();
        let key = VaultKey::generate()?;
        let sealed = crypto::seal(&key, KEY_CHECK_AAD, KEY_CHECK_PLAINTEXT)?;
        let mut key_check = sealed.nonce.to_vec();
        key_check.extend_from_slice(&sealed.ciphertext);

        // Persist the key first: a vault row without its key would be unrecoverable.
        key_store.save(&vault_id, &key)?;
        sqlx::query(
            "INSERT INTO vault_meta (id, vault_id, format_version, key_check, created_at) VALUES (1, ?, ?, ?, ?)",
        )
        .bind(&vault_id)
        .bind(VAULT_FORMAT_VERSION)
        .bind(key_check)
        .bind(super::now_ms())
        .execute(db.pool())
        .await?;

        Ok(Self {
            db,
            key: Arc::new(key),
            vault_id,
        })
    }

    pub fn vault_id(&self) -> &str {
        &self.vault_id
    }

    /// The underlying database, for device-local data such as settings.
    pub fn database(&self) -> &Database {
        &self.db
    }
}

fn verify_key_check(key: &VaultKey, key_check: &[u8]) -> Result<()> {
    if key_check.len() < crypto::NONCE_LEN {
        return Err(CoreError::InvalidData("key_check is truncated".into()));
    }
    let (nonce, ciphertext) = key_check.split_at(crypto::NONCE_LEN);
    match crypto::open(key, KEY_CHECK_AAD, nonce, ciphertext) {
        Ok(plain) if plain == KEY_CHECK_PLAINTEXT => Ok(()),
        _ => Err(CoreError::WrongVaultKey),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::key_store::MemoryKeyStore;

    #[tokio::test]
    async fn first_launch_creates_a_vault_and_stores_its_key() {
        let db = Database::open_in_memory().await.unwrap();
        let store = MemoryKeyStore::default();

        let vault = Vault::open_or_create(db.clone(), &store).await.unwrap();

        assert!(store.load(vault.vault_id()).unwrap().is_some());
        let version: i64 = sqlx::query_scalar("SELECT format_version FROM vault_meta")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(version, VAULT_FORMAT_VERSION);
    }

    #[tokio::test]
    async fn later_launches_reopen_the_same_vault_with_the_same_key() {
        let db = Database::open_in_memory().await.unwrap();
        let store = MemoryKeyStore::default();
        let first = Vault::open_or_create(db.clone(), &store).await.unwrap();
        let second = Vault::open_or_create(db, &store).await.unwrap();

        assert_eq!(first.vault_id(), second.vault_id());
        assert_eq!(first.key.as_bytes(), second.key.as_bytes());
    }

    #[tokio::test]
    async fn missing_key_in_the_keychain_is_reported() {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db.clone(), &MemoryKeyStore::default())
            .await
            .unwrap();

        let result = Vault::open_or_create(db, &MemoryKeyStore::default()).await;
        assert!(matches!(result, Err(CoreError::VaultKeyMissing)));
    }

    #[tokio::test]
    async fn a_different_key_is_detected_by_the_key_check() {
        let db = Database::open_in_memory().await.unwrap();
        let store = MemoryKeyStore::default();
        let vault = Vault::open_or_create(db.clone(), &store).await.unwrap();

        store
            .save(vault.vault_id(), &VaultKey::generate().unwrap())
            .unwrap();
        let result = Vault::open_or_create(db, &store).await;
        assert!(matches!(result, Err(CoreError::WrongVaultKey)));
    }

    #[test]
    fn truncated_key_check_is_invalid_data() {
        let key = VaultKey::generate().unwrap();
        assert!(matches!(
            verify_key_check(&key, &[0u8; 10]),
            Err(CoreError::InvalidData(_))
        ));
    }

    struct FailingStore;
    impl VaultKeyStore for FailingStore {
        fn load(&self, _: &str) -> Result<Option<VaultKey>> {
            Ok(None)
        }
        fn save(&self, _: &str, _: &VaultKey) -> Result<()> {
            Err(CoreError::Keychain("locked".into()))
        }
    }

    #[tokio::test]
    async fn no_vault_row_is_written_when_the_key_cannot_be_saved() {
        let db = Database::open_in_memory().await.unwrap();
        let result = Vault::open_or_create(db.clone(), &FailingStore).await;
        assert!(matches!(result, Err(CoreError::Keychain(_))));

        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_meta")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(rows, 0);
    }
}

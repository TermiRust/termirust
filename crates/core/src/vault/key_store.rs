use std::collections::HashMap;
use std::sync::Mutex;

use super::crypto::VaultKey;
use crate::{CoreError, Result};

/// Where the vault key lives between app launches.
pub trait VaultKeyStore: Send + Sync {
    fn load(&self, vault_id: &str) -> Result<Option<VaultKey>>;
    fn save(&self, vault_id: &str, key: &VaultKey) -> Result<()>;
}

/// macOS Keychain, Windows Credential Manager or the Secret Service on Linux.
pub struct OsKeychain {
    service: String,
}

impl OsKeychain {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, vault_id: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, &format!("vault-key:{vault_id}"))
            .map_err(|e| CoreError::Keychain(e.to_string()))
    }
}

impl OsKeychain {
    pub fn forget(&self, vault_id: &str) -> Result<()> {
        match self.entry(vault_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(CoreError::Keychain(e.to_string())),
        }
    }
}

impl VaultKeyStore for OsKeychain {
    fn load(&self, vault_id: &str) -> Result<Option<VaultKey>> {
        match self.entry(vault_id)?.get_secret() {
            Ok(mut bytes) => {
                let key = VaultKey::from_slice(&bytes);
                zeroize::Zeroize::zeroize(&mut bytes);
                key.map(Some)
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(CoreError::Keychain(e.to_string())),
        }
    }

    fn save(&self, vault_id: &str, key: &VaultKey) -> Result<()> {
        self.entry(vault_id)?
            .set_secret(key.as_bytes())
            .map_err(|e| CoreError::Keychain(e.to_string()))
    }
}

/// In-process store for tests and for platforms without a usable keychain.
#[derive(Default)]
pub struct MemoryKeyStore {
    keys: Mutex<HashMap<String, VaultKey>>,
}

impl VaultKeyStore for MemoryKeyStore {
    fn load(&self, vault_id: &str) -> Result<Option<VaultKey>> {
        Ok(self
            .keys
            .lock()
            .map_err(|_| CoreError::Keychain("memory key store poisoned".into()))?
            .get(vault_id)
            .cloned())
    }

    fn save(&self, vault_id: &str, key: &VaultKey) -> Result<()> {
        self.keys
            .lock()
            .map_err(|_| CoreError::Keychain("memory key store poisoned".into()))?
            .insert(vault_id.to_owned(), key.clone());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Touches the real OS keychain; run with `cargo test -p termirust-core -- --ignored`.
    #[test]
    #[ignore]
    fn os_keychain_round_trips_a_key() {
        let keychain = OsKeychain::new("dev.termirust.test");
        let vault_id = format!("test-{}", uuid::Uuid::now_v7());
        assert!(keychain.load(&vault_id).unwrap().is_none());

        let key = VaultKey::generate().unwrap();
        keychain.save(&vault_id, &key).unwrap();
        let loaded = keychain.load(&vault_id).unwrap().expect("key was saved");
        keychain.forget(&vault_id).unwrap();

        assert_eq!(loaded.as_bytes(), key.as_bytes());
        assert!(keychain.load(&vault_id).unwrap().is_none());
    }

    #[test]
    fn memory_store_returns_none_until_a_key_is_saved() {
        let store = MemoryKeyStore::default();
        assert!(store.load("v1").unwrap().is_none());

        let key = VaultKey::generate().unwrap();
        store.save("v1", &key).unwrap();
        assert_eq!(
            store.load("v1").unwrap().unwrap().as_bytes(),
            key.as_bytes()
        );
        assert!(store.load("other").unwrap().is_none());
    }
}

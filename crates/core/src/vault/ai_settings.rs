use serde::{Deserialize, Serialize};

use super::items::ItemKind;
use super::open::Vault;
use super::secret::Secret;
use crate::Result;
use crate::ai::provider::{ProviderConfig, ProviderKind};

/// The user's AI provider. Kept in the vault because it holds an API key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AiSettings {
    /// AI is off until the user turns it on.
    pub enabled: bool,
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<Secret>,
}

impl Default for AiSettings {
    fn default() -> Self {
        let kind = ProviderKind::Anthropic;
        Self {
            enabled: false,
            kind,
            base_url: kind.default_base_url().into(),
            model: kind.default_model().into(),
            api_key: None,
        }
    }
}

impl AiSettings {
    pub fn provider_config(&self) -> ProviderConfig {
        ProviderConfig {
            kind: self.kind,
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            api_key: self
                .api_key
                .as_ref()
                .filter(|k| !k.is_empty())
                .map(|k| k.expose().to_owned()),
        }
    }

    fn normalized(&self) -> Self {
        let mut settings = self.clone();
        settings.base_url = settings.base_url.trim().trim_end_matches('/').to_owned();
        if settings.base_url.is_empty() {
            settings.base_url = settings.kind.default_base_url().into();
        }
        settings.model = settings.model.trim().to_owned();
        if settings.model.is_empty() {
            settings.model = settings.kind.default_model().into();
        }
        settings.api_key = settings.api_key.filter(|k| !k.expose().trim().is_empty());
        settings
    }
}

pub struct AiSettingsRepository<'a> {
    vault: &'a Vault,
}

impl Vault {
    pub fn ai_settings(&self) -> AiSettingsRepository<'_> {
        AiSettingsRepository { vault: self }
    }
}

impl AiSettingsRepository<'_> {
    /// The saved settings, or the disabled defaults.
    pub async fn get(&self) -> Result<AiSettings> {
        let saved = self
            .vault
            .list_items::<AiSettings>(ItemKind::AiSettings)
            .await?;
        Ok(saved
            .into_iter()
            .next()
            .map(|r| r.payload)
            .unwrap_or_default())
    }

    pub async fn save(&self, settings: &AiSettings) -> Result<AiSettings> {
        let settings = settings.normalized();
        let existing = self
            .vault
            .list_items::<serde_json::Value>(ItemKind::AiSettings)
            .await?;
        match existing.first() {
            Some(record) => {
                self.vault
                    .update_item(ItemKind::AiSettings, record.meta.id, &settings)
                    .await?;
            }
            None => {
                self.vault
                    .insert_item(ItemKind::AiSettings, &settings)
                    .await?;
            }
        }
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use crate::vault::MemoryKeyStore;

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn ai_is_off_until_configured() {
        let settings = vault().await.ai_settings().get().await.unwrap();
        assert!(!settings.enabled);
        assert_eq!(settings.kind, ProviderKind::Anthropic);
        assert!(settings.api_key.is_none());
    }

    #[tokio::test]
    async fn saves_one_settings_item_with_the_key_encrypted() {
        let vault = vault().await;
        let repo = vault.ai_settings();
        let saved = repo
            .save(&AiSettings {
                enabled: true,
                kind: ProviderKind::OpenAiCompatible,
                base_url: " http://localhost:11434/v1/ ".into(),
                model: " ".into(),
                api_key: Some(Secret::new("sk-secret-value")),
            })
            .await
            .unwrap();
        assert_eq!(saved.base_url, "http://localhost:11434/v1");
        assert_eq!(saved.model, ProviderKind::OpenAiCompatible.default_model());

        let mut changed = saved.clone();
        changed.api_key = Some(Secret::new("  "));
        repo.save(&changed).await.unwrap();
        let back = repo.get().await.unwrap();
        assert!(back.api_key.is_none(), "a blank key means no key");
        assert_eq!(back.base_url, "http://localhost:11434/v1");

        let rows: Vec<Vec<u8>> = sqlx::query_scalar(
            "SELECT ciphertext FROM items WHERE kind = 'ai_settings' AND deleted_at IS NULL",
        )
        .fetch_all(vault.database().pool())
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn never_stores_the_key_in_plaintext() {
        let vault = vault().await;
        vault
            .ai_settings()
            .save(&AiSettings {
                api_key: Some(Secret::new("sk-ant-very-secret")),
                ..AiSettings::default()
            })
            .await
            .unwrap();
        let raw: Vec<u8> =
            sqlx::query_scalar("SELECT ciphertext FROM items WHERE kind = 'ai_settings'")
                .fetch_one(vault.database().pool())
                .await
                .unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("sk-ant-very-secret"));
    }

    #[test]
    fn builds_the_provider_config() {
        let config = AiSettings {
            api_key: Some(Secret::new("k")),
            ..AiSettings::default()
        }
        .provider_config();
        assert_eq!(config.api_key.as_deref(), Some("k"));
        assert_eq!(config.base_url, "https://api.anthropic.com");
    }
}

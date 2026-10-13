use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::items::{ItemKind, StoredItem};
use super::open::Vault;
use crate::{CoreError, Result};

/// A saved command. Encrypted like everything else: commands often embed tokens or paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snippet {
    pub name: String,
    /// May span lines and contain `{{name}}` / `{{name:default}}` variables.
    pub command: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

impl Snippet {
    fn normalized(&self) -> Result<Self> {
        let mut snippet = self.clone();
        snippet.name = snippet.name.trim().to_owned();
        snippet.description = snippet.description.trim().to_owned();
        // Trailing newlines would run the command a second time when sent with Enter.
        snippet.command = snippet.command.trim_end_matches(['\n', '\r']).to_owned();
        snippet.tags = snippet
            .tags
            .iter()
            .map(|t| t.trim().to_owned())
            .filter(|t| !t.is_empty())
            .fold(Vec::new(), |mut acc, t| {
                if !acc.contains(&t) {
                    acc.push(t);
                }
                acc
            });
        if snippet.command.trim().is_empty() {
            return Err(CoreError::InvalidData("the command is empty".into()));
        }
        if snippet.name.is_empty() {
            snippet.name = snippet
                .command
                .lines()
                .next()
                .unwrap_or_default()
                .chars()
                .take(40)
                .collect();
        }
        Ok(snippet)
    }
}

pub type SnippetRecord = StoredItem<Snippet>;

pub struct SnippetRepository<'a> {
    vault: &'a Vault,
}

impl Vault {
    pub fn snippets(&self) -> SnippetRepository<'_> {
        SnippetRepository { vault: self }
    }
}

impl SnippetRepository<'_> {
    pub async fn create(&self, snippet: &Snippet) -> Result<SnippetRecord> {
        let snippet = snippet.normalized()?;
        let meta = self.vault.insert_item(ItemKind::Snippet, &snippet).await?;
        Ok(StoredItem {
            meta,
            payload: snippet,
        })
    }

    pub async fn update(&self, id: Uuid, snippet: &Snippet) -> Result<SnippetRecord> {
        let snippet = snippet.normalized()?;
        let meta = self
            .vault
            .update_item(ItemKind::Snippet, id, &snippet)
            .await?;
        Ok(StoredItem {
            meta,
            payload: snippet,
        })
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        self.vault.delete_item(ItemKind::Snippet, id).await
    }

    pub async fn list(&self) -> Result<Vec<SnippetRecord>> {
        self.vault.list_items(ItemKind::Snippet).await
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

    fn snippet(name: &str, command: &str) -> Snippet {
        Snippet {
            name: name.into(),
            command: command.into(),
            description: String::new(),
            tags: vec![" logs ".into(), "logs".into(), "".into()],
        }
    }

    #[tokio::test]
    async fn stores_snippets_encrypted_and_tidied() {
        let vault = vault().await;
        let saved = vault
            .snippets()
            .create(&snippet("", "journalctl -u {{service:nginx}} -f\n"))
            .await
            .unwrap();
        assert_eq!(saved.payload.command, "journalctl -u {{service:nginx}} -f");
        assert_eq!(saved.payload.name, "journalctl -u {{service:nginx}} -f");
        assert_eq!(saved.payload.tags, ["logs"]);

        let raw: Vec<u8> =
            sqlx::query_scalar("SELECT ciphertext FROM items WHERE kind = 'snippet'")
                .fetch_one(vault.database().pool())
                .await
                .unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("journalctl"));
    }

    #[tokio::test]
    async fn rejects_empty_commands_and_supports_update_and_delete() {
        let vault = vault().await;
        let repo = vault.snippets();
        assert!(repo.create(&snippet("x", " \n")).await.is_err());

        let saved = repo.create(&snippet("Disk", "df -h")).await.unwrap();
        let updated = repo
            .update(
                saved.meta.id,
                &Snippet {
                    command: "df -h /".into(),
                    ..saved.payload.clone()
                },
            )
            .await
            .unwrap();
        assert_eq!(updated.payload.command, "df -h /");
        assert_eq!(repo.list().await.unwrap().len(), 1);
        repo.delete(saved.meta.id).await.unwrap();
        assert!(repo.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn keeps_multi_line_commands_intact() {
        let vault = vault().await;
        let saved = vault
            .snippets()
            .create(&snippet(
                "deploy",
                "cd /srv/app\ngit pull\nsystemctl restart app\n\n",
            ))
            .await
            .unwrap();
        assert_eq!(
            saved.payload.command,
            "cd /srv/app\ngit pull\nsystemctl restart app"
        );
    }
}

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::items::{ItemKind, StoredItem};
use super::open::Vault;
use crate::{CoreError, Result};

/// A quote attached to a question, e.g. "L35–L55" and the text it covered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatQuoteRecord {
    pub label: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessageRecord {
    pub role: ChatRole,
    pub text: String,
    #[serde(default)]
    pub quotes: Vec<ChatQuoteRecord>,
}

/// One AI conversation. Encrypted like everything else: it holds terminal output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiChat {
    /// The server it was about; `None` for a local terminal. Kept after the host is deleted.
    pub host_id: Option<Uuid>,
    /// The host's name when the chat happened, so history still reads well once it is gone.
    pub host_label: String,
    pub title: String,
    pub messages: Vec<ChatMessageRecord>,
}

/// Oldest messages beyond this are dropped when saving, so one chat cannot grow without bound.
pub const MAX_CHAT_MESSAGES: usize = 200;

impl AiChat {
    fn normalized(&self) -> Result<Self> {
        let mut chat = self.clone();
        if chat.messages.is_empty() {
            return Err(CoreError::InvalidData(
                "a chat needs at least one message".into(),
            ));
        }
        let skip = chat.messages.len().saturating_sub(MAX_CHAT_MESSAGES);
        chat.messages.drain(..skip);
        chat.title = chat.title.trim().chars().take(80).collect();
        if chat.title.is_empty() {
            chat.title = "Untitled chat".into();
        }
        Ok(chat)
    }
}

pub type AiChatRecord = StoredItem<AiChat>;

pub struct AiChatRepository<'a> {
    vault: &'a Vault,
}

impl Vault {
    pub fn ai_chats(&self) -> AiChatRepository<'_> {
        AiChatRepository { vault: self }
    }
}

impl AiChatRepository<'_> {
    pub async fn create(&self, chat: &AiChat) -> Result<AiChatRecord> {
        let chat = chat.normalized()?;
        let meta = self.vault.insert_item(ItemKind::AiChat, &chat).await?;
        Ok(StoredItem {
            meta,
            payload: chat,
        })
    }

    pub async fn update(&self, id: Uuid, chat: &AiChat) -> Result<AiChatRecord> {
        let chat = chat.normalized()?;
        let meta = self.vault.update_item(ItemKind::AiChat, id, &chat).await?;
        Ok(StoredItem {
            meta,
            payload: chat,
        })
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<AiChatRecord>> {
        self.vault.get_item(ItemKind::AiChat, id).await
    }

    /// Newest first.
    pub async fn list(&self) -> Result<Vec<AiChatRecord>> {
        let mut chats: Vec<AiChatRecord> = self.vault.list_items(ItemKind::AiChat).await?;
        chats.sort_by(|a, b| {
            b.meta
                .updated_at
                .cmp(&a.meta.updated_at)
                .then(b.meta.id.cmp(&a.meta.id))
        });
        Ok(chats)
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        self.vault.delete_item(ItemKind::AiChat, id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use crate::vault::{Host, MemoryKeyStore};

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    fn message(role: ChatRole, text: &str) -> ChatMessageRecord {
        ChatMessageRecord {
            role,
            text: text.into(),
            quotes: vec![],
        }
    }

    fn chat(host_id: Option<Uuid>, title: &str) -> AiChat {
        AiChat {
            host_id,
            host_label: "prod-db".into(),
            title: title.into(),
            messages: vec![
                message(ChatRole::User, "why is it slow?"),
                message(ChatRole::Assistant, "Check `top`."),
            ],
        }
    }

    #[tokio::test]
    async fn stores_chats_encrypted_and_lists_newest_first() {
        let vault = vault().await;
        let repo = vault.ai_chats();
        let first = repo.create(&chat(None, "first")).await.unwrap();
        let second = repo.create(&chat(None, "second")).await.unwrap();
        // Timestamps are in milliseconds; make the update land strictly later.
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let mut updated = first.payload.clone();
        updated.messages.push(message(ChatRole::User, "and now?"));
        repo.update(first.meta.id, &updated).await.unwrap();

        let listed: Vec<_> = repo
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.payload.title)
            .collect();
        assert_eq!(
            listed,
            ["first", "second"],
            "the chat updated last comes first"
        );
        assert_eq!(
            repo.get(second.meta.id)
                .await
                .unwrap()
                .unwrap()
                .payload
                .messages
                .len(),
            2
        );

        let raw: Vec<Vec<u8>> = sqlx::query_scalar(
            "SELECT ciphertext FROM items WHERE kind = 'ai_chat' AND deleted_at IS NULL",
        )
        .fetch_all(vault.database().pool())
        .await
        .unwrap();
        assert!(
            raw.iter()
                .all(|r| !String::from_utf8_lossy(r).contains("why is it slow"))
        );
    }

    #[tokio::test]
    async fn keeps_a_chat_after_its_host_is_deleted() {
        let vault = vault().await;
        let host = vault
            .hosts()
            .create(&Host::new("db"))
            .await
            .unwrap()
            .meta
            .id;
        let saved = vault
            .ai_chats()
            .create(&chat(Some(host), "db issue"))
            .await
            .unwrap();
        vault.hosts().delete(host).await.unwrap();
        let kept = vault
            .ai_chats()
            .get(saved.meta.id)
            .await
            .unwrap()
            .unwrap()
            .payload;
        assert_eq!(
            (kept.host_id, kept.host_label.as_str()),
            (Some(host), "prod-db")
        );
    }

    #[tokio::test]
    async fn tidies_titles_caps_length_and_rejects_empty_chats() {
        let vault = vault().await;
        let repo = vault.ai_chats();
        assert!(
            repo.create(&AiChat {
                messages: vec![],
                ..chat(None, "x")
            })
            .await
            .is_err()
        );
        let mut long = chat(None, "   ");
        long.messages = (0..250)
            .map(|i| message(ChatRole::User, &format!("m{i}")))
            .collect();
        let saved = repo.create(&long).await.unwrap().payload;
        assert_eq!(saved.title, "Untitled chat");
        assert_eq!(saved.messages.len(), MAX_CHAT_MESSAGES);
        assert_eq!(saved.messages[0].text, "m50");

        let id = repo.create(&chat(None, "bye")).await.unwrap().meta.id;
        repo.delete(id).await.unwrap();
        assert!(repo.get(id).await.unwrap().is_none());
    }
}

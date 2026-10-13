use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use super::crypto;
use super::open::Vault;
use crate::{CoreError, Result};

/// Highest payload schema version this build understands.
const PAYLOAD_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Host,
    Group,
    Identity,
    KnownHost,
}

impl ItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemKind::Host => "host",
            ItemKind::Group => "group",
            ItemKind::Identity => "identity",
            ItemKind::KnownHost => "known_host",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemMeta {
    pub id: Uuid,
    pub revision: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredItem<T> {
    pub meta: ItemMeta,
    pub payload: T,
}

#[derive(Serialize, Deserialize)]
struct Envelope<T> {
    v: u32,
    #[serde(flatten)]
    data: T,
}

fn associated_data(id: &Uuid, kind: ItemKind) -> Vec<u8> {
    format!("termirust:v1:{id}:{}", kind.as_str()).into_bytes()
}

type ItemRow = (String, i64, i64, i64, Vec<u8>, Vec<u8>);

impl Vault {
    fn seal_payload<T: Serialize>(
        &self,
        id: &Uuid,
        kind: ItemKind,
        payload: &T,
    ) -> Result<crypto::Sealed> {
        let mut plaintext = serde_json::to_vec(&Envelope {
            v: PAYLOAD_VERSION,
            data: payload,
        })
        .map_err(|e| CoreError::InvalidData(e.to_string()))?;
        let sealed = crypto::seal(&self.key, &associated_data(id, kind), &plaintext);
        plaintext.zeroize();
        sealed
    }

    fn open_row<T: DeserializeOwned>(&self, kind: ItemKind, row: ItemRow) -> Result<StoredItem<T>> {
        let (id, revision, created_at, updated_at, nonce, ciphertext) = row;
        let id = Uuid::parse_str(&id).map_err(|e| CoreError::InvalidData(e.to_string()))?;
        let mut plaintext =
            crypto::open(&self.key, &associated_data(&id, kind), &nonce, &ciphertext)?;
        let envelope: std::result::Result<Envelope<T>, _> = serde_json::from_slice(&plaintext);
        plaintext.zeroize();
        let envelope = envelope.map_err(|e| CoreError::InvalidData(e.to_string()))?;
        if envelope.v > PAYLOAD_VERSION {
            return Err(CoreError::InvalidData(format!(
                "{} {id} uses payload version {}, newer than this app supports",
                kind.as_str(),
                envelope.v
            )));
        }
        Ok(StoredItem {
            meta: ItemMeta {
                id,
                revision,
                created_at,
                updated_at,
            },
            payload: envelope.data,
        })
    }

    pub(crate) async fn insert_item<T: Serialize>(
        &self,
        kind: ItemKind,
        payload: &T,
    ) -> Result<ItemMeta> {
        let id = Uuid::now_v7();
        let sealed = self.seal_payload(&id, kind, payload)?;
        let now = super::now_ms();
        sqlx::query(
            "INSERT INTO items (id, kind, revision, created_at, updated_at, nonce, ciphertext) VALUES (?, ?, 1, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(kind.as_str())
        .bind(now)
        .bind(now)
        .bind(sealed.nonce.to_vec())
        .bind(sealed.ciphertext)
        .execute(self.db.pool())
        .await?;
        Ok(ItemMeta {
            id,
            revision: 1,
            created_at: now,
            updated_at: now,
        })
    }

    pub(crate) async fn update_item<T: Serialize>(
        &self,
        kind: ItemKind,
        id: Uuid,
        payload: &T,
    ) -> Result<ItemMeta> {
        let sealed = self.seal_payload(&id, kind, payload)?;
        let now = super::now_ms();
        let row: Option<(i64, i64)> = sqlx::query_as(
            "UPDATE items SET revision = revision + 1, updated_at = ?, nonce = ?, ciphertext = ?,
                 sync_state = CASE sync_state WHEN 'synced' THEN 'dirty' ELSE sync_state END
             WHERE id = ? AND kind = ? AND deleted_at IS NULL
             RETURNING revision, created_at",
        )
        .bind(now)
        .bind(sealed.nonce.to_vec())
        .bind(sealed.ciphertext)
        .bind(id.to_string())
        .bind(kind.as_str())
        .fetch_optional(self.db.pool())
        .await?;
        let (revision, created_at) = row.ok_or_else(|| not_found(kind, id))?;
        Ok(ItemMeta {
            id,
            revision,
            created_at,
            updated_at: now,
        })
    }

    /// Soft delete: the row stays as a tombstone (so other devices learn about it) but the
    /// encrypted payload is erased.
    pub(crate) async fn delete_item(&self, kind: ItemKind, id: Uuid) -> Result<()> {
        let now = super::now_ms();
        let result = sqlx::query(
            "UPDATE items SET revision = revision + 1, updated_at = ?, deleted_at = ?, nonce = NULL, ciphertext = NULL,
                 sync_state = CASE sync_state WHEN 'synced' THEN 'dirty' ELSE sync_state END
             WHERE id = ? AND kind = ? AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(now)
        .bind(id.to_string())
        .bind(kind.as_str())
        .execute(self.db.pool())
        .await?;
        if result.rows_affected() == 0 {
            return Err(not_found(kind, id));
        }
        Ok(())
    }

    pub(crate) async fn get_item<T: DeserializeOwned>(
        &self,
        kind: ItemKind,
        id: Uuid,
    ) -> Result<Option<StoredItem<T>>> {
        let row: Option<ItemRow> = sqlx::query_as(
            "SELECT id, revision, created_at, updated_at, nonce, ciphertext FROM items
             WHERE id = ? AND kind = ? AND deleted_at IS NULL",
        )
        .bind(id.to_string())
        .bind(kind.as_str())
        .fetch_optional(self.db.pool())
        .await?;
        row.map(|r| self.open_row(kind, r)).transpose()
    }

    pub(crate) async fn list_items<T: DeserializeOwned>(
        &self,
        kind: ItemKind,
    ) -> Result<Vec<StoredItem<T>>> {
        let rows: Vec<ItemRow> = sqlx::query_as(
            "SELECT id, revision, created_at, updated_at, nonce, ciphertext FROM items
             WHERE kind = ? AND deleted_at IS NULL ORDER BY id",
        )
        .bind(kind.as_str())
        .fetch_all(self.db.pool())
        .await?;
        rows.into_iter().map(|r| self.open_row(kind, r)).collect()
    }
}

pub(crate) fn not_found(kind: ItemKind, id: Uuid) -> CoreError {
    CoreError::NotFound {
        kind: kind.as_str(),
        id: id.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use crate::vault::MemoryKeyStore;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct Note {
        text: String,
    }

    fn note(text: &str) -> Note {
        Note { text: text.into() }
    }

    async fn vault() -> Vault {
        let db = Database::open_in_memory().await.unwrap();
        Vault::open_or_create(db, &MemoryKeyStore::default())
            .await
            .unwrap()
    }

    async fn raw_row(vault: &Vault, id: Uuid) -> (i64, Option<i64>, Option<Vec<u8>>, String) {
        sqlx::query_as(
            "SELECT revision, deleted_at, ciphertext, sync_state FROM items WHERE id = ?",
        )
        .bind(id.to_string())
        .fetch_one(vault.db.pool())
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn stores_payloads_encrypted_and_reads_them_back() {
        let vault = vault().await;
        let meta = vault
            .insert_item(ItemKind::Host, &note("prod-db.internal"))
            .await
            .unwrap();

        assert_eq!(meta.id.get_version_num(), 7);
        assert_eq!(meta.revision, 1);
        let (_, _, ciphertext, state) = raw_row(&vault, meta.id).await;
        let ciphertext = ciphertext.unwrap();
        assert!(!String::from_utf8_lossy(&ciphertext).contains("prod-db"));
        assert_eq!(state, "local");

        let item = vault
            .get_item::<Note>(ItemKind::Host, meta.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(item.payload, note("prod-db.internal"));
        assert_eq!(item.meta, meta);
    }

    #[tokio::test]
    async fn update_bumps_revision_and_replaces_the_payload() {
        let vault = vault().await;
        let meta = vault.insert_item(ItemKind::Host, &note("a")).await.unwrap();
        let updated = vault
            .update_item(ItemKind::Host, meta.id, &note("b"))
            .await
            .unwrap();

        assert_eq!(updated.revision, 2);
        assert_eq!(updated.created_at, meta.created_at);
        assert!(updated.updated_at >= meta.updated_at);
        let item = vault
            .get_item::<Note>(ItemKind::Host, meta.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(item.payload, note("b"));
    }

    #[tokio::test]
    async fn changes_to_a_synced_item_mark_it_dirty() {
        let vault = vault().await;
        let meta = vault.insert_item(ItemKind::Host, &note("a")).await.unwrap();
        sqlx::query("UPDATE items SET sync_state = 'synced' WHERE id = ?")
            .bind(meta.id.to_string())
            .execute(vault.db.pool())
            .await
            .unwrap();

        vault
            .update_item(ItemKind::Host, meta.id, &note("b"))
            .await
            .unwrap();
        assert_eq!(raw_row(&vault, meta.id).await.3, "dirty");
    }

    #[tokio::test]
    async fn delete_leaves_a_tombstone_without_payload() {
        let vault = vault().await;
        let meta = vault.insert_item(ItemKind::Host, &note("a")).await.unwrap();
        vault.delete_item(ItemKind::Host, meta.id).await.unwrap();

        let (revision, deleted_at, ciphertext, _) = raw_row(&vault, meta.id).await;
        assert_eq!(revision, 2);
        assert!(deleted_at.is_some());
        assert!(ciphertext.is_none());
        assert!(
            vault
                .get_item::<Note>(ItemKind::Host, meta.id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            vault
                .list_items::<Note>(ItemKind::Host)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn updating_or_deleting_a_missing_or_deleted_item_is_not_found() {
        let vault = vault().await;
        let missing = Uuid::now_v7();
        assert!(matches!(
            vault.update_item(ItemKind::Host, missing, &note("x")).await,
            Err(CoreError::NotFound { kind: "host", .. })
        ));
        assert!(matches!(
            vault.delete_item(ItemKind::Host, missing).await,
            Err(CoreError::NotFound { .. })
        ));

        let meta = vault.insert_item(ItemKind::Host, &note("a")).await.unwrap();
        vault.delete_item(ItemKind::Host, meta.id).await.unwrap();
        assert!(vault.delete_item(ItemKind::Host, meta.id).await.is_err());
        assert!(
            vault
                .update_item(ItemKind::Host, meta.id, &note("b"))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn items_of_another_kind_are_invisible() {
        let vault = vault().await;
        let meta = vault.insert_item(ItemKind::Host, &note("a")).await.unwrap();
        assert!(
            vault
                .get_item::<Note>(ItemKind::Group, meta.id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            vault
                .list_items::<Note>(ItemKind::Group)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn list_returns_items_in_creation_order() {
        let vault = vault().await;
        for text in ["one", "two", "three"] {
            vault
                .insert_item(ItemKind::Host, &note(text))
                .await
                .unwrap();
        }
        let texts: Vec<String> = vault
            .list_items::<Note>(ItemKind::Host)
            .await
            .unwrap()
            .into_iter()
            .map(|i| i.payload.text)
            .collect();
        assert_eq!(texts, ["one", "two", "three"]);
    }

    #[tokio::test]
    async fn ciphertext_moved_to_another_item_fails_to_decrypt() {
        let vault = vault().await;
        let a = vault.insert_item(ItemKind::Host, &note("a")).await.unwrap();
        let b = vault.insert_item(ItemKind::Host, &note("b")).await.unwrap();
        sqlx::query("UPDATE items SET (nonce, ciphertext) = (SELECT nonce, ciphertext FROM items WHERE id = ?) WHERE id = ?")
            .bind(a.id.to_string())
            .bind(b.id.to_string())
            .execute(vault.db.pool())
            .await
            .unwrap();

        assert!(matches!(
            vault.get_item::<Note>(ItemKind::Host, b.id).await,
            Err(CoreError::DecryptionFailed)
        ));
    }

    #[tokio::test]
    async fn a_payload_from_a_newer_app_version_is_rejected() {
        let vault = vault().await;
        let id = Uuid::now_v7();
        let sealed = crypto::seal(
            &vault.key,
            &associated_data(&id, ItemKind::Host),
            br#"{"v":99,"text":"future"}"#,
        )
        .unwrap();
        sqlx::query("INSERT INTO items (id, kind, created_at, updated_at, nonce, ciphertext) VALUES (?, 'host', 0, 0, ?, ?)")
            .bind(id.to_string())
            .bind(sealed.nonce.to_vec())
            .bind(sealed.ciphertext)
            .execute(vault.db.pool())
            .await
            .unwrap();

        let err = vault
            .get_item::<Note>(ItemKind::Host, id)
            .await
            .unwrap_err();
        assert!(matches!(err, CoreError::InvalidData(msg) if msg.contains("payload version 99")));
    }
}

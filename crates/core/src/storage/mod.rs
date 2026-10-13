use std::path::Path;
use std::str::FromStr;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

use crate::{CoreError, Result};

pub const DATABASE_FILE_NAME: &str = "vault.db";

static MIGRATIONS: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// The local SQLite database holding the encrypted vault and device settings.
#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Opens (creating if needed) the database file and applies pending migrations.
    pub async fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| CoreError::Storage(e.to_string()))?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .foreign_keys(true);
        Self::connect(options, 4).await
    }

    pub async fn open_in_memory() -> Result<Self> {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        // Each in-memory connection is its own database, so keep exactly one.
        Self::connect(options, 1).await
    }

    async fn connect(options: SqliteConnectOptions, max_connections: u32) -> Result<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        MIGRATIONS
            .run(&pool)
            .await
            .map_err(|e| CoreError::Storage(e.to_string()))?;
        Ok(Self { pool })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

impl From<sqlx::Error> for CoreError {
    fn from(err: sqlx::Error) -> Self {
        CoreError::Storage(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn table_names(db: &Database) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(db.pool())
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn migrations_create_the_vault_tables() {
        let db = Database::open_in_memory().await.unwrap();
        assert_eq!(table_names(&db).await, ["items", "settings", "vault_meta"]);
    }

    #[tokio::test]
    async fn creates_missing_parent_directories_and_uses_wal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/app data").join(DATABASE_FILE_NAME);
        let db = Database::open(&path).await.unwrap();

        assert!(path.exists());
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(mode, "wal");
    }

    #[tokio::test]
    async fn reopening_an_existing_database_keeps_its_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DATABASE_FILE_NAME);
        {
            let db = Database::open(&path).await.unwrap();
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES ('terminal.theme', '\"dracula\"')",
            )
            .execute(db.pool())
            .await
            .unwrap();
            db.pool().close().await;
        }
        let db = Database::open(&path).await.unwrap();
        let value: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = 'terminal.theme'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(value, "\"dracula\"");
    }

    #[tokio::test]
    async fn rejects_a_live_item_without_ciphertext() {
        let db = Database::open_in_memory().await.unwrap();
        let result = sqlx::query(
            "INSERT INTO items (id, kind, created_at, updated_at) VALUES ('x', 'host', 0, 0)",
        )
        .execute(db.pool())
        .await;
        assert!(
            result.is_err(),
            "a live item must carry nonce and ciphertext"
        );
    }

    #[tokio::test]
    async fn rejects_an_unknown_sync_state() {
        let db = Database::open_in_memory().await.unwrap();
        let result = sqlx::query(
            "INSERT INTO items (id, kind, created_at, updated_at, deleted_at, sync_state) VALUES ('x', 'host', 0, 0, 0, 'weird')",
        )
        .execute(db.pool())
        .await;
        assert!(result.is_err());
    }
}

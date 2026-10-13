use serde::Serialize;
use serde::de::DeserializeOwned;

use super::Database;
use crate::{CoreError, Result};

/// Device-local preferences (fonts, theme…): plain JSON, never secret, never synced.
pub struct Settings<'a> {
    db: &'a Database,
}

impl Database {
    pub fn settings(&self) -> Settings<'_> {
        Settings { db: self }
    }
}

impl Settings<'_> {
    /// Returns `None` when the key was never saved or no longer matches `T`.
    pub async fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(self.db.pool())
            .await?;
        Ok(value.and_then(|v| serde_json::from_str(&v).ok()))
    }

    pub async fn set<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let json =
            serde_json::to_string(value).map_err(|e| CoreError::InvalidData(e.to_string()))?;
        sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(key)
            .bind(json)
            .execute(self.db.pool())
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Font {
        family: String,
        size: u8,
    }

    #[tokio::test]
    async fn round_trips_and_overwrites_values() {
        let db = Database::open_in_memory().await.unwrap();
        assert_eq!(
            db.settings().get::<Font>("terminal.font").await.unwrap(),
            None
        );

        db.settings()
            .set(
                "terminal.font",
                &Font {
                    family: "Menlo".into(),
                    size: 13,
                },
            )
            .await
            .unwrap();
        db.settings()
            .set(
                "terminal.font",
                &Font {
                    family: "Fira Code".into(),
                    size: 14,
                },
            )
            .await
            .unwrap();

        assert_eq!(
            db.settings().get::<Font>("terminal.font").await.unwrap(),
            Some(Font {
                family: "Fira Code".into(),
                size: 14
            })
        );
    }

    #[tokio::test]
    async fn a_value_saved_in_an_older_shape_reads_as_missing() {
        let db = Database::open_in_memory().await.unwrap();
        db.settings()
            .set("terminal.font", &"just a string")
            .await
            .unwrap();
        assert_eq!(
            db.settings().get::<Font>("terminal.font").await.unwrap(),
            None
        );
    }
}

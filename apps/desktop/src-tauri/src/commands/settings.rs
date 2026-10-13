use serde::{Deserialize, Serialize};
use tauri::State;

use crate::command_error::CommandError;
use crate::vault_state::VaultState;

const TERMINAL_KEY: &str = "terminal";
pub const THEMES: &[&str] = &[
    "termirust-dark",
    "dracula",
    "solarized-dark",
    "nord",
    "gruvbox-dark",
    "tokyo-night",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CursorStyle {
    Block,
    Bar,
    Underline,
}

/// Terminal preferences; missing or out-of-range values fall back to defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f64,
    pub theme: String,
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
    pub scrollback: u32,
    pub copy_on_select: bool,
    pub confirm_multiline_paste: bool,
    pub show_status_bar: bool,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            font_family: "\"JetBrains Mono\", Menlo, Consolas, monospace".into(),
            font_size: 13,
            line_height: 1.2,
            theme: "termirust-dark".into(),
            cursor_style: CursorStyle::Block,
            cursor_blink: true,
            scrollback: 10_000,
            copy_on_select: false,
            confirm_multiline_paste: true,
            show_status_bar: true,
        }
    }
}

impl TerminalSettings {
    /// Clamps numbers into usable ranges and replaces unknown themes or empty fonts.
    pub fn sanitized(mut self) -> Self {
        let defaults = Self::default();
        self.font_size = self.font_size.clamp(8, 32);
        self.line_height = if self.line_height.is_finite() {
            self.line_height.clamp(1.0, 2.0)
        } else {
            defaults.line_height
        };
        self.scrollback = self.scrollback.min(100_000);
        if !THEMES.contains(&self.theme.as_str()) {
            self.theme = defaults.theme;
        }
        if self.font_family.trim().is_empty() {
            self.font_family = defaults.font_family;
        }
        self
    }
}

#[tauri::command]
#[specta::specta]
pub async fn settings_terminal_get(
    state: State<'_, VaultState>,
) -> Result<TerminalSettings, CommandError> {
    let saved = state
        .vault()
        .await?
        .database()
        .settings()
        .get::<TerminalSettings>(TERMINAL_KEY)
        .await?;
    Ok(saved.unwrap_or_default().sanitized())
}

#[tauri::command]
#[specta::specta]
pub async fn settings_terminal_set(
    state: State<'_, VaultState>,
    settings: TerminalSettings,
) -> Result<TerminalSettings, CommandError> {
    let settings = settings.sanitized();
    state
        .vault()
        .await?
        .database()
        .settings()
        .set(TERMINAL_KEY, &settings)
        .await?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_out_of_range_values_and_unknown_themes() {
        let wild = TerminalSettings {
            font_size: 200,
            line_height: f64::NAN,
            scrollback: 10_000_000,
            theme: "neon".into(),
            font_family: "  ".into(),
            ..TerminalSettings::default()
        }
        .sanitized();
        assert_eq!(wild.font_size, 32);
        assert_eq!(wild.line_height, 1.2);
        assert_eq!(wild.scrollback, 100_000);
        assert_eq!(wild.theme, "termirust-dark");
        assert!(wild.font_family.contains("JetBrains Mono"));

        let small = TerminalSettings {
            font_size: 2,
            line_height: 0.5,
            ..TerminalSettings::default()
        }
        .sanitized();
        assert_eq!((small.font_size, small.line_height), (8, 1.0));
    }

    #[test]
    fn partial_json_from_an_older_version_keeps_defaults_for_new_fields() {
        let parsed: TerminalSettings =
            serde_json::from_str(r#"{"fontSize":15,"theme":"nord"}"#).unwrap();
        assert_eq!(parsed.font_size, 15);
        assert_eq!(parsed.theme, "nord");
        assert!(parsed.confirm_multiline_paste);
        assert!(parsed.show_status_bar);
    }

    #[tokio::test]
    async fn persists_through_the_database() {
        let db = termirust_core::storage::Database::open_in_memory()
            .await
            .unwrap();
        let custom = TerminalSettings {
            theme: "dracula".into(),
            copy_on_select: true,
            ..TerminalSettings::default()
        };
        db.settings().set(TERMINAL_KEY, &custom).await.unwrap();
        assert_eq!(
            db.settings()
                .get::<TerminalSettings>(TERMINAL_KEY)
                .await
                .unwrap(),
            Some(custom)
        );
    }
}

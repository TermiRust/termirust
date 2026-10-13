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

/// Most imported themes a user can keep; enough for any real collection.
const MAX_CUSTOM_THEMES: usize = 50;

/// A colour scheme imported from iTerm2 or Windows Terminal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    /// Always starts with "custom-" so it never shadows a built-in theme.
    pub id: String,
    pub name: String,
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection: String,
    /// The 16 ANSI colours: black, red, green, yellow, blue, magenta, cyan, white, then bright.
    pub ansi: Vec<String>,
}

fn is_hex_colour(value: &str) -> bool {
    let digits = value.strip_prefix('#').unwrap_or("");
    matches!(digits.len(), 6 | 8) && digits.chars().all(|c| c.is_ascii_hexdigit())
}

impl CustomTheme {
    fn is_valid(&self) -> bool {
        self.id.starts_with("custom-")
            && self.id.len() <= 64
            && !self.name.trim().is_empty()
            && self.name.len() <= 80
            && self.ansi.len() == 16
            && [
                &self.background,
                &self.foreground,
                &self.cursor,
                &self.selection,
            ]
            .into_iter()
            .chain(self.ansi.iter())
            .all(|c| is_hex_colour(c))
    }
}

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
    pub custom_themes: Vec<CustomTheme>,
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
            custom_themes: Vec::new(),
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
        // Settings are stored outside the vault and rendered in the webview: keep only clean colours.
        let mut seen = std::collections::HashSet::new();
        self.custom_themes
            .retain(|t| t.is_valid() && seen.insert(t.id.clone()));
        self.custom_themes.truncate(MAX_CUSTOM_THEMES);
        let custom = self.custom_themes.iter().any(|t| t.id == self.theme);
        if !THEMES.contains(&self.theme.as_str()) && !custom {
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

    fn custom(id: &str) -> CustomTheme {
        CustomTheme {
            id: id.into(),
            name: "Mine".into(),
            background: "#101010".into(),
            foreground: "#eeeeee".into(),
            cursor: "#ff8800".into(),
            selection: "#44444480".into(),
            ansi: vec!["#000000".into(); 16],
        }
    }

    #[test]
    fn keeps_only_valid_custom_themes_and_allows_selecting_them() {
        let mut bad_colour = custom("custom-b");
        bad_colour.background = "red; background:url(x)".into();
        let mut short = custom("custom-c");
        short.ansi.pop();
        let settings = TerminalSettings {
            theme: "custom-a".into(),
            custom_themes: vec![
                custom("custom-a"),
                custom("custom-a"),
                bad_colour,
                short,
                custom("dracula"),
            ],
            ..TerminalSettings::default()
        }
        .sanitized();
        assert_eq!(settings.custom_themes, vec![custom("custom-a")]);
        assert_eq!(settings.theme, "custom-a");

        let orphan = TerminalSettings {
            theme: "custom-gone".into(),
            ..TerminalSettings::default()
        }
        .sanitized();
        assert_eq!(orphan.theme, "termirust-dark");
    }

    #[test]
    fn partial_json_from_an_older_version_keeps_defaults_for_new_fields() {
        let parsed: TerminalSettings =
            serde_json::from_str(r#"{"fontSize":15,"theme":"nord"}"#).unwrap();
        assert_eq!(parsed.font_size, 15);
        assert_eq!(parsed.theme, "nord");
        assert!(parsed.confirm_multiline_paste);
        assert!(parsed.show_status_bar);
        assert!(parsed.custom_themes.is_empty());
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

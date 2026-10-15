import type { CustomTheme } from "@/bindings";

const KEY = "termirust.theme";

export interface ThemeCache {
  appTheme: string;
  customThemes: CustomTheme[];
}

const FALLBACK: ThemeCache = { appTheme: "system", customThemes: [] };

/**
 * The app theme lives in the vault, which opens only after the OS keychain answers; a copy
 * here (colours only, nothing secret) lets the window open in the right theme straight away.
 */
export function saveThemeCache(theme: ThemeCache): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ appTheme: theme.appTheme, customThemes: theme.customThemes }));
  } catch {
    // Storage can be unavailable; the theme then appears once the vault is open, as before.
  }
}

export function loadThemeCache(): ThemeCache {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      const { appTheme, customThemes } = parsed as Record<string, unknown>;
      if (typeof appTheme === "string" && Array.isArray(customThemes)) return { appTheme, customThemes: customThemes as CustomTheme[] };
    }
  } catch {
    // Broken JSON: fall back.
  }
  return FALLBACK;
}

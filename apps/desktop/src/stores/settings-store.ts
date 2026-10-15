import { create } from "zustand";

import { commands, type TerminalSettings } from "@/bindings";
import { loadThemeCache, saveThemeCache } from "@/lib/theme-cache";

/** Terminal settings with every field present (the generated type marks them optional). */
export type ResolvedTerminalSettings = { [K in keyof TerminalSettings]-?: NonNullable<TerminalSettings[K]> };

export const DEFAULT_TERMINAL_SETTINGS: ResolvedTerminalSettings = {
  fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.2,
  theme: "match-app",
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 10_000,
  copyOnSelect: false,
  confirmMultilinePaste: true,
  showStatusBar: true,
  customThemes: [],
  appTheme: "system",
};

export function resolveTerminalSettings(raw: TerminalSettings): ResolvedTerminalSettings {
  const merged = { ...DEFAULT_TERMINAL_SETTINGS };
  for (const key of Object.keys(merged) as (keyof ResolvedTerminalSettings)[]) {
    const value = raw[key];
    if (value !== undefined && value !== null) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

interface SettingsState {
  terminal: ResolvedTerminalSettings;
  error: string | null;
  load: () => Promise<void>;
  /** Applies immediately, then saves; the saved (sanitised) value wins. */
  updateTerminal: (patch: Partial<ResolvedTerminalSettings>) => Promise<void>;
}

/** Settings as read from the vault; the theme is also copied for the next start-up. */
function stored(raw: TerminalSettings): ResolvedTerminalSettings {
  const terminal = resolveTerminalSettings(raw);
  saveThemeCache({ appTheme: terminal.appTheme, customThemes: terminal.customThemes });
  return terminal;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  // Until the vault opens, use the theme seen last time instead of flashing the default.
  terminal: { ...DEFAULT_TERMINAL_SETTINGS, ...loadThemeCache() },
  error: null,

  load: async () => {
    const result = await commands.settingsTerminalGet();
    if (result.status === "ok") set({ terminal: stored(result.data), error: null });
    else set({ error: result.error.message });
  },

  updateTerminal: async (patch) => {
    const next = { ...get().terminal, ...patch };
    set({ terminal: next });
    const result = await commands.settingsTerminalSet(next);
    if (result.status === "ok") set({ terminal: stored(result.data), error: null });
    else set({ error: result.error.message });
  },
}));

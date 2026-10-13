import { create } from "zustand";

import { commands, type TerminalSettings } from "@/bindings";

/** Terminal settings with every field present (the generated type marks them optional). */
export type ResolvedTerminalSettings = { [K in keyof TerminalSettings]-?: NonNullable<TerminalSettings[K]> };

export const DEFAULT_TERMINAL_SETTINGS: ResolvedTerminalSettings = {
  fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.2,
  theme: "termirust-dark",
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 10_000,
  copyOnSelect: false,
  confirmMultilinePaste: true,
  showStatusBar: true,
  customThemes: [],
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

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  terminal: DEFAULT_TERMINAL_SETTINGS,
  error: null,

  load: async () => {
    const result = await commands.settingsTerminalGet();
    if (result.status === "ok") set({ terminal: resolveTerminalSettings(result.data), error: null });
    else set({ error: result.error.message });
  },

  updateTerminal: async (patch) => {
    const next = { ...get().terminal, ...patch };
    set({ terminal: next });
    const result = await commands.settingsTerminalSet(next);
    if (result.status === "ok") set({ terminal: resolveTerminalSettings(result.data), error: null });
    else set({ error: result.error.message });
  },
}));

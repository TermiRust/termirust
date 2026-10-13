import { create } from "zustand";

import { commands, type AiSettingsInput, type AiSettingsView, type CommandError } from "@/bindings";

type Outcome<T> = { status: "ok"; data: T } | { status: "error"; error: CommandError };

const ALWAYS_PREVIEW_KEY = "termirust.ai.alwaysPreview";

function readAlwaysPreview(): boolean {
  try {
    return localStorage.getItem(ALWAYS_PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

interface AiState {
  settings: AiSettingsView | null;
  error: string | null;
  /** The first request of each app session is always previewed. */
  previewedThisSession: boolean;
  alwaysPreview: boolean;
  load: () => Promise<void>;
  save: (input: AiSettingsInput) => Promise<Outcome<AiSettingsView>>;
  markPreviewed: () => void;
  setAlwaysPreview: (always: boolean) => void;
}

export const useAiStore = create<AiState>()((set) => ({
  settings: null,
  error: null,
  previewedThisSession: false,
  alwaysPreview: readAlwaysPreview(),

  load: async () => {
    const result = await commands.aiSettingsGet();
    if (result.status === "ok") set({ settings: result.data, error: null });
    else set({ error: result.error.message });
  },

  save: async (input) => {
    const result = await commands.aiSettingsSet(input);
    if (result.status === "ok") set({ settings: result.data, error: null });
    return result;
  },

  markPreviewed: () => set({ previewedThisSession: true }),

  setAlwaysPreview: (always) => {
    try {
      localStorage.setItem(ALWAYS_PREVIEW_KEY, always ? "1" : "0");
    } catch {
      // Private mode or blocked storage: the choice lasts for this session only.
    }
    set({ alwaysPreview: always });
  },
}));

export const needsPreview = (s: Pick<AiState, "previewedThisSession" | "alwaysPreview">) => s.alwaysPreview || !s.previewedThisSession;

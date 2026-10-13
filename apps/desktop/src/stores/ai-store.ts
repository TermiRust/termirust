import { create } from "zustand";

import { commands, type AiSettingsInput, type AiSettingsView, type CommandError } from "@/bindings";

type Outcome<T> = { status: "ok"; data: T } | { status: "error"; error: CommandError };

interface AiState {
  settings: AiSettingsView | null;
  error: string | null;
  load: () => Promise<void>;
  save: (input: AiSettingsInput) => Promise<Outcome<AiSettingsView>>;
}

export const useAiStore = create<AiState>()((set) => ({
  settings: null,
  error: null,

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
}));

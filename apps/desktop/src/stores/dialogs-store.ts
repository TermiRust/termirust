import { create } from "zustand";

import type { HostView } from "@/bindings";

export type HostEditor = { mode: "new" } | { mode: "edit"; host: HostView } | null;

interface DialogsState {
  hostEditor: HostEditor;
  importConfigOpen: boolean;
  paletteOpen: boolean;
  openNewHost: () => void;
  openHostEditor: (host: HostView) => void;
  closeHostEditor: () => void;
  setImportConfigOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
}

/** App-wide dialogs, so the sidebar, shortcuts and the command palette can all open them. */
export const useDialogsStore = create<DialogsState>()((set) => ({
  hostEditor: null,
  importConfigOpen: false,
  paletteOpen: false,
  openNewHost: () => set({ hostEditor: { mode: "new" }, paletteOpen: false }),
  openHostEditor: (host) => set({ hostEditor: { mode: "edit", host }, paletteOpen: false }),
  closeHostEditor: () => set({ hostEditor: null }),
  setImportConfigOpen: (importConfigOpen) => set({ importConfigOpen, paletteOpen: false }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));

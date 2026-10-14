import { create } from "zustand";

/** "hosts" is the terminal workspace (tabs); "library" is the saved-host manager. */
export type Section = "hosts" | "library" | "sftp" | "monitor" | "keychain" | "snippets" | "forwards" | "settings";

interface LayoutState {
  section: Section;
  setSection: (section: Section) => void;
  sidebarVisible: boolean;
  toggleSidebar: () => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  section: "hosts",
  setSection: (section) => set({ section }),
  sidebarVisible: true,
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
}));

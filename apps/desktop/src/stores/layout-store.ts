import { create } from "zustand";

/** "hosts" is the terminal workspace (tabs); "library" is the saved-host manager. */
export type Section = "hosts" | "library" | "keychain" | "snippets" | "forwards" | "settings";

interface LayoutState {
  section: Section;
  setSection: (section: Section) => void;
  sidebarVisible: boolean;
  hostFilter: string;
  toggleSidebar: () => void;
  setHostFilter: (filter: string) => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  section: "hosts",
  setSection: (section) => set({ section }),
  sidebarVisible: true,
  hostFilter: "",
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  setHostFilter: (hostFilter) => set({ hostFilter }),
}));

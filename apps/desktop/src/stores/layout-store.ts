import { create } from "zustand";

export type Section = "hosts" | "keychain" | "snippets" | "forwards" | "settings";

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

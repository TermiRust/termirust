import { create } from "zustand";

interface LayoutState {
  sidebarVisible: boolean;
  hostFilter: string;
  toggleSidebar: () => void;
  setHostFilter: (filter: string) => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  sidebarVisible: true,
  hostFilter: "",
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
  setHostFilter: (hostFilter) => set({ hostFilter }),
}));

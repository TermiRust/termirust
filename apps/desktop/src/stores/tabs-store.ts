import { create } from "zustand";

import type { HostView } from "@/bindings";
import type { TabColor } from "@/features/tabs/tab-color";

export type TabStatus = "connecting" | "connected" | "disconnected" | "error" | "idle";

export type TabTarget = { kind: "host"; host: HostView } | { kind: "local" } | { kind: "lab" };

export interface Tab {
  id: string;
  title: string;
  target: TabTarget;
  status: TabStatus;
  color: TabColor | null;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  openHostTab: (host: HostView, color: TabColor | null) => string;
  openLabTab: () => string;
  openLocalTab: () => string;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  activateTabAt: (index: number) => void;
  setTabStatus: (id: string, status: TabStatus) => void;
  renameTab: (id: string, title: string) => void;
  moveTab: (id: string, toIndex: number) => void;
}

let counter = 0;
const nextId = () => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const useTabsStore = create<TabsState>()((set, get) => {
  const open = (tab: Omit<Tab, "id">) => {
    const id = nextId();
    set((s) => ({ tabs: [...s.tabs, { ...tab, id }], activeTabId: id }));
    return id;
  };

  return {
    tabs: [],
    activeTabId: null,

    openHostTab: (host, color) => open({ title: host.label, target: { kind: "host", host }, status: "connecting", color }),
    openLabTab: () => open({ title: "Connection lab", target: { kind: "lab" }, status: "idle", color: null }),
    openLocalTab: () => open({ title: "Local", target: { kind: "local" }, status: "connecting", color: null }),

    /** Closing the active tab activates its right neighbour, or the left one at the end. */
    closeTab: (id) =>
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id);
        if (index === -1) return s;
        const tabs = s.tabs.filter((t) => t.id !== id);
        const activeTabId =
          s.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeTabId;
        return { tabs, activeTabId };
      }),

    activateTab: (id) => {
      if (get().tabs.some((t) => t.id === id)) set({ activeTabId: id });
    },

    /** Index 8 (⌘9) always means the last tab, like browsers. */
    activateTabAt: (index) => {
      const { tabs } = get();
      const tab = index >= 8 ? tabs[tabs.length - 1] : tabs[index];
      if (tab) set({ activeTabId: tab.id });
    },

    setTabStatus: (id, status) =>
      set((s) =>
        s.tabs.some((t) => t.id === id && t.status !== status)
          ? { tabs: s.tabs.map((t) => (t.id === id ? { ...t, status } : t)) }
          : s,
      ),

    renameTab: (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)) }));
    },

    moveTab: (id, toIndex) =>
      set((s) => {
        const from = s.tabs.findIndex((t) => t.id === id);
        if (from === -1) return s;
        const tabs = [...s.tabs];
        const [tab] = tabs.splice(from, 1);
        if (!tab) return s;
        tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
        return { tabs };
      }),
  };
});

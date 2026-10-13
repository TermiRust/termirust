import { create } from "zustand";

import type { HostView } from "@/bindings";
import { closePane, neighbour, paneIds, setRatio, singlePane, splitPane, type Direction, type PaneNode } from "@/features/panes/pane-tree";
import type { TabColor } from "@/features/tabs/tab-color";

import { forgetPendingInput } from "./terminal-inputs";

export type TabStatus = "connecting" | "connected" | "disconnected" | "error" | "idle";

export type TabTarget = { kind: "host"; host: HostView } | { kind: "sftp"; host: HostView } | { kind: "local" } | { kind: "lab" };

export interface Tab {
  id: string;
  title: string;
  target: TabTarget;
  status: TabStatus;
  color: TabColor | null;
  /** Terminal size in characters, once the terminal has measured itself. */
  size: { cols: number; rows: number } | null;
  /** Terminal tabs can be split; every pane runs its own session to the same target. */
  layout: PaneNode;
  focusedPaneId: string;
  paneStatus: Record<string, TabStatus>;
  /** Keystrokes in the focused pane go to every pane of the tab. */
  broadcast: boolean;
}

export const splittable = (tab: Tab) => tab.target.kind === "host" || tab.target.kind === "local";

/** Connected while any pane is; otherwise whatever the focused pane reports. */
function aggregateStatus(tab: Pick<Tab, "paneStatus" | "focusedPaneId" | "status">): TabStatus {
  const statuses = Object.values(tab.paneStatus);
  if (statuses.includes("connected")) return "connected";
  return tab.paneStatus[tab.focusedPaneId] ?? tab.status;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  openHostTab: (host: HostView, color: TabColor | null) => string;
  openSftpTab: (host: HostView, color: TabColor | null) => string;
  openLabTab: () => string;
  openLocalTab: () => string;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  activateTabAt: (index: number) => void;
  setTabStatus: (id: string, status: TabStatus) => void;
  setTabSize: (id: string, cols: number, rows: number) => void;
  renameTab: (id: string, title: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  splitPane: (tabId: string, direction: "row" | "column") => void;
  closePane: (tabId: string, paneId: string) => void;
  focusPane: (tabId: string, paneId: string) => void;
  focusNeighbour: (tabId: string, direction: Direction) => void;
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  setPaneStatus: (tabId: string, paneId: string, status: TabStatus) => void;
  toggleBroadcast: (tabId: string) => void;
}

let counter = 0;
const nextId = () => `tab-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const useTabsStore = create<TabsState>()((set, get) => {
  type NewTab = Omit<Tab, "id" | "layout" | "focusedPaneId" | "paneStatus" | "broadcast">;
  const open = (tab: NewTab) => {
    const id = nextId();
    const paneId = nextId();
    set((s) => ({
      tabs: [...s.tabs, { ...tab, id, layout: singlePane(paneId), focusedPaneId: paneId, paneStatus: {}, broadcast: false }],
      activeTabId: id,
    }));
    return id;
  };
  const updateTab = (tabId: string, change: (tab: Tab) => Tab) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? change(t) : t)) }));

  return {
    tabs: [],
    activeTabId: null,

    openHostTab: (host, color) => open({ title: host.label, target: { kind: "host", host }, status: "connecting", color, size: null }),
    openSftpTab: (host, color) =>
      open({ title: `${host.label} · SFTP`, target: { kind: "sftp", host }, status: "connecting", color, size: null }),
    openLabTab: () => open({ title: "Connection lab", target: { kind: "lab" }, status: "idle", color: null, size: null }),
    openLocalTab: () => open({ title: "Local", target: { kind: "local" }, status: "connecting", color: null, size: null }),

    /** Closing the active tab activates its right neighbour, or the left one at the end. */
    closeTab: (id) => {
      forgetPendingInput(id);
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id);
        if (index === -1) return s;
        const tabs = s.tabs.filter((t) => t.id !== id);
        const activeTabId =
          s.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeTabId;
        return { tabs, activeTabId };
      });
    },

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

    setTabSize: (id, cols, rows) =>
      set((s) =>
        s.tabs.some((t) => t.id === id && (t.size?.cols !== cols || t.size?.rows !== rows))
          ? { tabs: s.tabs.map((t) => (t.id === id ? { ...t, size: { cols, rows } } : t)) }
          : s,
      ),

    renameTab: (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)) }));
    },

    splitPane: (tabId, direction) =>
      updateTab(tabId, (tab) => {
        if (!splittable(tab)) return tab;
        const paneId = nextId();
        return { ...tab, layout: splitPane(tab.layout, tab.focusedPaneId, direction, paneId, nextId()), focusedPaneId: paneId };
      }),

    closePane: (tabId, paneId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const layout = closePane(tab.layout, paneId);
      if (!layout) {
        get().closeTab(tabId);
        return;
      }
      updateTab(tabId, (t) => {
        const paneStatus = Object.fromEntries(Object.entries(t.paneStatus).filter(([id]) => id !== paneId));
        const focusedPaneId = t.focusedPaneId === paneId ? (neighbour(t.layout, paneId, "left") ?? neighbour(t.layout, paneId, "up") ?? paneIds(layout)[0] ?? "") : t.focusedPaneId;
        const next = { ...t, layout, paneStatus, focusedPaneId, broadcast: t.broadcast && paneIds(layout).length > 1 };
        return { ...next, status: aggregateStatus(next) };
      });
    },

    focusPane: (tabId, paneId) =>
      updateTab(tabId, (tab) => (paneIds(tab.layout).includes(paneId) && tab.focusedPaneId !== paneId ? { ...tab, focusedPaneId: paneId } : tab)),

    focusNeighbour: (tabId, direction) =>
      updateTab(tabId, (tab) => {
        const next = neighbour(tab.layout, tab.focusedPaneId, direction);
        return next ? { ...tab, focusedPaneId: next } : tab;
      }),

    setSplitRatio: (tabId, splitId, ratio) => updateTab(tabId, (tab) => ({ ...tab, layout: setRatio(tab.layout, splitId, ratio) })),

    setPaneStatus: (tabId, paneId, status) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === tabId);
        if (!tab || tab.paneStatus[paneId] === status) return s;
        const paneStatus = { ...tab.paneStatus, [paneId]: status };
        const updated = { ...tab, paneStatus, status: aggregateStatus({ ...tab, paneStatus }) };
        return { tabs: s.tabs.map((t) => (t.id === tabId ? updated : t)) };
      }),

    toggleBroadcast: (tabId) => updateTab(tabId, (tab) => (paneIds(tab.layout).length > 1 ? { ...tab, broadcast: !tab.broadcast } : tab)),

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

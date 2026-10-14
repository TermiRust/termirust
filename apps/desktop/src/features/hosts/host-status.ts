import type { DotState } from "@/components/ui/status-dot";
import { paneIds } from "@/features/panes/pane-tree";
import { paneTargetOf, type Tab, type TabStatus } from "@/stores/tabs-store";

export function dotForStatus(status: TabStatus): DotState {
  switch (status) {
    case "connected":
      return "on";
    case "connecting":
      return "warn";
    case "error":
    case "disconnected":
      return "err";
    case "idle":
      return "idle";
  }
}

const RANK: Record<DotState, number> = { on: 3, warn: 2, err: 1, idle: 0 };

/** Statuses of everything open on a host: SFTP tabs and terminal panes, split panes included. */
function hostStatuses(hostId: string, tab: Tab): TabStatus[] {
  if (tab.target.kind === "sftp") return tab.target.host.id === hostId ? [tab.status] : [];
  return paneIds(tab.layout)
    .filter((id) => {
      const target = paneTargetOf(tab, id);
      return target?.kind === "host" && target.host.id === hostId;
    })
    .map((id) => tab.paneStatus[id] ?? tab.status);
}

/** A host's dot from all its open tabs and panes: the healthiest one wins. */
export function hostDot(hostId: string, tabs: Tab[]): DotState {
  return tabs
    .flatMap((t) => hostStatuses(hostId, t))
    .map(dotForStatus)
    .reduce<DotState>((best, dot) => (RANK[dot] > RANK[best] ? dot : best), "idle");
}

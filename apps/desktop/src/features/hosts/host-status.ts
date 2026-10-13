import type { DotState } from "@/components/ui/status-dot";
import type { Tab, TabStatus } from "@/stores/tabs-store";

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

/** A host's dot from all its open tabs (terminal and SFTP): the healthiest one wins. */
export function hostDot(hostId: string, tabs: Tab[]): DotState {
  return tabs
    .filter((t) => (t.target.kind === "host" || t.target.kind === "sftp") && t.target.host.id === hostId)
    .map((t) => dotForStatus(t.status))
    .reduce<DotState>((best, dot) => (RANK[dot] > RANK[best] ? dot : best), "idle");
}

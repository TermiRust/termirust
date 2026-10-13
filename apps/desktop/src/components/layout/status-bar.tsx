import { FolderTree, KeyRound, Route, SquareTerminal } from "lucide-react";

import type { HostView } from "@/bindings";
import { cn } from "@/lib/utils";
import type { Tab, TabStatus } from "@/stores/tabs-store";

const dot: Record<TabStatus, string> = {
  connecting: "bg-warn",
  connected: "bg-ok",
  disconnected: "bg-fg-faint",
  error: "bg-danger",
  idle: "bg-fg-faint",
};

const authLabel = (host: HostView) => (host.auth.method === "identity" ? "key" : host.auth.method === "agent" ? "agent" : "password");

interface StatusBarProps {
  tab: Tab | undefined;
  hosts: HostView[];
}

/** One line of facts about the active tab, as in the mockup's main window. */
export function StatusBar({ tab, hosts }: StatusBarProps) {
  if (!tab) return null;
  const parts: React.ReactNode[] = [];

  const terminal = tab.target.kind !== "sftp";
  if (tab.target.kind === "host" || tab.target.kind === "sftp") {
    const opened = tab.target.host;
    const host = hosts.find((h) => h.id === opened.id) ?? opened;
    const jump = host.jumpHostId ? hosts.find((h) => h.id === host.jumpHostId) : undefined;
    parts.push(
      <span key="who" className="text-fg-2">
        {host.username ? `${host.username}@` : ""}
        {host.label}
      </span>,
      <span key="where" className="font-mono">
        {host.hostname}:{host.port}
      </span>,
    );
    if (jump) {
      parts.push(
        <span key="jump" className="flex items-center gap-1">
          <Route size={11} /> via {jump.label}
        </span>,
      );
    }
    parts.push(
      <span key="auth" className="flex items-center gap-1">
        <KeyRound size={11} /> {authLabel(host)}
      </span>,
    );
    if (!terminal) {
      parts.push(
        <span key="sftp" className="flex items-center gap-1">
          <FolderTree size={11} /> SFTP
        </span>,
      );
    }
  } else if (tab.target.kind === "local") {
    parts.push(
      <span key="local" className="flex items-center gap-1 text-fg-2">
        <SquareTerminal size={11} /> Local shell
      </span>,
    );
  } else {
    parts.push(
      <span key="lab" className="text-fg-2">
        Connection lab
      </span>,
    );
  }

  return (
    <footer aria-label="Status bar" className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-bg-sunk px-3 text-[11px] text-fg-muted">
      <span aria-label={`Status: ${tab.status}`} className={cn("h-2 w-2 shrink-0 rounded-full", dot[tab.status])} />
      {parts}
      <span className="ml-auto flex items-center gap-3">
        {terminal && <span>UTF-8</span>}
        {terminal && <span>xterm-256color</span>}
        {tab.size && (
          <span className="font-mono tabular-nums">
            {tab.size.cols} × {tab.size.rows}
          </span>
        )}
      </span>
    </footer>
  );
}

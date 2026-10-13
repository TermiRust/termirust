import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { TerminalView, type TerminalHandle } from "@/features/terminal/terminal-view";
import type { TabStatus } from "@/stores/tabs-store";

import { useLocalSession, type LocalSessionState } from "./use-local-session";

const tabStatusOf: Record<LocalSessionState["phase"], TabStatus> = {
  starting: "connecting",
  running: "connected",
  exited: "disconnected",
  error: "error",
};

export function LocalSessionView({ onStatusChange }: { onStatusChange?: (status: TabStatus) => void }) {
  const terminalRef = useRef<TerminalHandle>(null);
  const getTerminal = useCallback(() => terminalRef.current, []);
  const session = useLocalSession(getTerminal);
  const { state } = session;

  useEffect(() => {
    onStatusChange?.(tabStatusOf[state.phase]);
  }, [state.phase, onStatusChange]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(state.phase === "exited" || state.phase === "error") && (
        <div role="status" className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-bg-sunk px-3 text-xs text-fg-muted">
          {state.phase === "error" ? (
            <span className="text-danger">{state.message}</span>
          ) : (
            <span>Shell exited{state.exitStatus === null ? "" : ` (exit ${state.exitStatus})`}</span>
          )}
          <Button size="sm" variant="outline" className="ml-auto" onClick={session.restart}>
            <RotateCw size={13} /> Restart shell
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TerminalView ref={terminalRef} onData={session.send} onResize={session.resize} />
      </div>
    </div>
  );
}

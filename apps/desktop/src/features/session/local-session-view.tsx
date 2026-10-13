import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useAiAllowed } from "@/features/ai/use-ai-allowed";
import { useTerminalAi } from "@/features/ai/use-terminal-ai";
import { TerminalView, type TerminalHandle, type TerminalSize } from "@/features/terminal/terminal-view";
import type { TabStatus } from "@/stores/tabs-store";
import { registerTerminalInput } from "@/stores/terminal-inputs";

import { useLocalSession, type LocalSessionState } from "./use-local-session";

const tabStatusOf: Record<LocalSessionState["phase"], TabStatus> = {
  starting: "connecting",
  running: "connected",
  exited: "disconnected",
  error: "error",
};

interface LocalSessionViewProps {
  onStatusChange?: (status: TabStatus) => void;
  onSizeChange?: (size: TerminalSize) => void;
  /** Lets snippets type into this tab while the shell runs. */
  tabId?: string;
}

export function LocalSessionView({ onStatusChange, onSizeChange, tabId }: LocalSessionViewProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const getTerminal = useCallback(() => terminalRef.current, []);
  const session = useLocalSession(getTerminal);
  const { state } = session;
  const ai = useTerminalAi({
    allowed: useAiAllowed(null),
    target: "local",
    hostId: null,
    insert: session.send,
    focusTerminal: () => terminalRef.current?.focus(),
  });

  useEffect(() => {
    onStatusChange?.(tabStatusOf[state.phase]);
  }, [state.phase, onStatusChange]);

  const running = state.phase === "running";
  useEffect(() => (running && tabId ? registerTerminalInput(tabId, session.send) : undefined), [running, tabId, session.send]);

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
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-hidden" onContextMenu={(e) => ai.onContextMenu(e, terminalRef.current?.selection() ?? "")}>
          <TerminalView
            ref={terminalRef}
            onData={session.send}
            onAskAi={ai.onAskAi}
            onResize={(size) => {
              session.resize(size);
              onSizeChange?.(size);
            }}
          />
          {ai.commandBar}
        </div>
        {ai.explainPanel}
      </div>
      {ai.contextMenu}
    </div>
  );
}

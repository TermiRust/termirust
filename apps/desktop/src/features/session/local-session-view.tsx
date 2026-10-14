import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useAiAllowed } from "@/features/ai/use-ai-allowed";
import { useTerminalAi } from "@/features/ai/use-terminal-ai";
import { TerminalView, type TerminalHandle, type TerminalSize } from "@/features/terminal/terminal-view";
import type { TabStatus } from "@/stores/tabs-store";
import { broadcastToTab, registerPaneInput, registerTerminalInput } from "@/stores/terminal-inputs";

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
  /** False for a pane that is not the tab's focused one; it then stays out of the input routing. */
  focused?: boolean;
  /** Shown above the terminal when the tab is split, so panes can be told apart. */
  title?: string;
  /** This pane's id inside the tab, so broadcast input can reach it. */
  paneId?: string;
  /** Keystrokes typed here go to every pane of the tab. */
  broadcast?: boolean;
  /** Lets snippets type into this tab while the shell runs. */
  tabId?: string;
}

export function LocalSessionView({ onStatusChange, onSizeChange, tabId, paneId, broadcast = false, focused = true, title }: LocalSessionViewProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const getTerminal = useCallback(() => terminalRef.current, []);
  const session = useLocalSession(getTerminal);
  const { state } = session;
  const ai = useTerminalAi({
    allowed: useAiAllowed(null),
    target: "local",
    hostId: null,
    hostLabel: "Local",
    insert: session.send,
    focusTerminal: () => terminalRef.current?.focus(),
    readScreen: () => terminalRef.current?.screenExcerpt() ?? null,
  });

  useEffect(() => {
    onStatusChange?.(tabStatusOf[state.phase]);
  }, [state.phase, onStatusChange]);

  const running = state.phase === "running";
  useEffect(() => (running && focused && tabId ? registerTerminalInput(tabId, session.send) : undefined), [running, focused, tabId, session.send]);
  useEffect(() => (running && tabId && paneId ? registerPaneInput(tabId, paneId, session.send) : undefined), [running, tabId, paneId, session.send]);
  const sendTyped = useCallback(
    (data: string) => {
      if (broadcast && tabId && broadcastToTab(tabId, data) > 0) return;
      session.send(data);
    },
    [broadcast, tabId, session],
  );

  // Clicking or moving focus to this pane puts the keyboard in its terminal.
  useEffect(() => {
    if (focused) terminalRef.current?.focus();
  }, [focused]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {title && <div className="flex h-6 shrink-0 items-center border-b border-border px-2 text-[11px] text-fg-muted">{title}</div>}
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
        <div className="relative min-h-0 flex-1 overflow-hidden" onContextMenu={(e) => ai.onContextMenu(e, terminalRef.current?.selectionExcerpt() ?? null)}>
          <TerminalView
            ref={terminalRef}
            onData={sendTyped}
            forcePasteConfirmation={broadcast}
            onAskAi={ai.onAskAi && (() => ai.onAskAi?.(terminalRef.current?.selectionExcerpt() ?? null))}
            onResize={(size) => {
              session.resize(size);
              onSizeChange?.(size);
            }}
          />
        </div>
        {ai.panel}
      </div>
      {ai.contextMenu}
    </div>
  );
}

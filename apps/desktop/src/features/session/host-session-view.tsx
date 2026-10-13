import { ArrowLeft, PlugZap, RotateCw } from "lucide-react";
import { useCallback, useRef } from "react";

import type { HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { TerminalView, type TerminalHandle } from "@/features/terminal/terminal-view";

import { HostKeyDialog } from "./host-key-dialog";
import { PasswordPrompt } from "./password-prompt";
import { useHostSession, type HostSessionState } from "./use-host-session";

interface HostSessionViewProps {
  host: HostView;
  onExit: () => void;
}

export function HostSessionView({ host, onExit }: HostSessionViewProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const getTerminal = useCallback(() => terminalRef.current, []);
  const session = useHostSession(host, getTerminal);
  const { state } = session;
  const endpoint = `${host.hostname}:${host.port}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <Button size="icon" aria-label="Back" onClick={onExit}>
          <ArrowLeft size={15} />
        </Button>
        <span className="font-medium">{host.label}</span>
        <span className="font-mono text-xs text-fg-muted">
          {host.username ? `${host.username}@` : ""}
          {endpoint}
        </span>
        <StatusText state={state} />
        <div className="ml-auto flex gap-2">
          {state.phase === "connected" ? (
            <Button size="sm" variant="outline" onClick={() => void session.disconnect()}>
              <PlugZap size={14} /> Disconnect
            </Button>
          ) : state.phase === "connecting" ? null : (
            <Button size="sm" variant="outline" onClick={session.reconnect}>
              <RotateCw size={14} /> Reconnect
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <TerminalView ref={terminalRef} onData={session.send} onResize={session.resize} />
      </div>

      {state.phase === "needsPassword" && (
        <PasswordPrompt
          hostLabel={host.label}
          usernameRequired={state.usernameRequired}
          savedPasswordRejected={state.savedPasswordRejected}
          onSubmit={session.submitPassword}
          onCancel={session.cancel}
        />
      )}
      {(state.phase === "hostKeyUnknown" || state.phase === "hostKeyChanged") && (
        <HostKeyDialog
          endpoint={endpoint}
          algorithm={state.algorithm}
          fingerprint={state.fingerprint}
          previousFingerprint={state.phase === "hostKeyChanged" ? state.previousFingerprint : undefined}
          onTrust={() => session.trustHostKey(state.fingerprint)}
          onCancel={session.cancel}
        />
      )}
    </div>
  );
}

function StatusText({ state }: { state: HostSessionState }) {
  const text: Partial<Record<HostSessionState["phase"], string>> = {
    connecting: "Connecting…",
    connected: "Connected",
    cancelled: "Not connected",
  };
  const message =
    state.phase === "error"
      ? state.message
      : state.phase === "closed"
        ? `Disconnected${state.exitStatus === null ? "" : ` (exit ${state.exitStatus})`}`
        : text[state.phase];
  if (!message) return null;
  return (
    <span role="status" className={`text-xs ${state.phase === "error" ? "text-accent" : "text-fg-muted"}`}>
      · {message}
    </span>
  );
}

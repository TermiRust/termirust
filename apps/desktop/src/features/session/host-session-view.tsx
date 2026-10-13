import { PlugZap, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import type { HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { TerminalView, type TerminalHandle } from "@/features/terminal/terminal-view";
import type { TabStatus } from "@/stores/tabs-store";

import { HostKeyDialog } from "./host-key-dialog";
import { CredentialsPrompt, type CredentialsRequest } from "./credentials-prompt";
import { useHostSession, type HostSessionState } from "./use-host-session";

interface HostSessionViewProps {
  host: HostView;
  onStatusChange?: (status: TabStatus) => void;
}

const tabStatusOf: Record<HostSessionState["phase"], TabStatus> = {
  connecting: "connecting",
  needsPassword: "connecting",
  needsPassphrase: "connecting",
  needsUsername: "connecting",
  hostKeyUnknown: "connecting",
  hostKeyChanged: "connecting",
  connected: "connected",
  closed: "disconnected",
  cancelled: "disconnected",
  error: "error",
};

export function HostSessionView({ host, onStatusChange }: HostSessionViewProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const getTerminal = useCallback(() => terminalRef.current, []);
  const session = useHostSession(host, getTerminal);
  const { state } = session;
  const endpoint = `${host.hostname}:${host.port}`;
  const credentials = credentialsRequest(state);

  useEffect(() => {
    onStatusChange?.(tabStatusOf[state.phase]);
  }, [state.phase, onStatusChange]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
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

      {credentials && (
        <CredentialsPrompt
          key={state.phase}
          hostLabel={host.label}
          endpoint={endpoint}
          request={credentials}
          onSubmit={session.submitCredentials}
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

function credentialsRequest(state: HostSessionState): CredentialsRequest | null {
  switch (state.phase) {
    case "needsPassword":
      return { kind: "password", usernameRequired: state.usernameRequired, savedPasswordRejected: state.savedPasswordRejected };
    case "needsPassphrase":
      return { kind: "passphrase", keyLabel: state.keyLabel, wrongPassphrase: state.wrongPassphrase, usernameRequired: state.usernameRequired };
    case "needsUsername":
      return { kind: "username" };
    default:
      return null;
  }
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

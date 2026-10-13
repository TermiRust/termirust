import { PlugZap } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import type { HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { TerminalView, type TerminalHandle, type TerminalSize } from "@/features/terminal/terminal-view";
import type { TabStatus } from "@/stores/tabs-store";

import { HostKeyDialog } from "./host-key-dialog";
import { ConnectionBanner } from "./connection-banner";
import { CredentialsPrompt, type CredentialsRequest } from "./credentials-prompt";
import { useAutoReconnect } from "./use-auto-reconnect";
import { useHostSession, type HostSessionState } from "./use-host-session";

interface HostSessionViewProps {
  host: HostView;
  onStatusChange?: (status: TabStatus) => void;
  onSizeChange?: (size: TerminalSize) => void;
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

export function HostSessionView({ host, onStatusChange, onSizeChange }: HostSessionViewProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const getTerminal = useCallback(() => terminalRef.current, []);
  const session = useHostSession(host, getTerminal);
  const { state } = session;
  const endpoint = `${host.hostname}:${host.port}`;
  const credentials = credentialsRequest(state);
  const waitingToRetry = session.recovering && (state.phase === "closed" || state.phase === "error");
  const auto = useAutoReconnect(waitingToRetry, state.phase === "connected", session.reconnect);
  const dimmed = session.everConnected && state.phase !== "connected";

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
        <div className="ml-auto flex gap-2">
          {state.phase === "connected" && (
            <Button size="sm" variant="outline" onClick={() => void session.disconnect()}>
              <PlugZap size={14} /> Disconnect
            </Button>
          )}
        </div>
      </header>

      <ConnectionBanner state={state} recovering={session.recovering} auto={auto} onReconnect={session.reconnect} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <TerminalView
          ref={terminalRef}
          onData={session.send}
          onResize={(size) => {
            session.resize(size);
            onSizeChange?.(size);
          }}
        />
        {dimmed && <div aria-hidden className="pointer-events-none absolute inset-0 bg-bg/45" />}
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
          endpoint={state.server}
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

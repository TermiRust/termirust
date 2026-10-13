import { FolderTree, PlugZap, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { AiCommandBar } from "@/features/ai/ai-command-bar";
import { useAiAllowed } from "@/features/ai/use-ai-allowed";
import { aiShortcutLabel, isMacPlatform } from "@/lib/shortcuts";
import { TerminalView, type TerminalHandle, type TerminalSize } from "@/features/terminal/terminal-view";
import { useForwardsStore } from "@/stores/forwards-store";
import type { TabStatus } from "@/stores/tabs-store";

import { HostKeyDialog } from "./host-key-dialog";
import { ConnectionBanner } from "./connection-banner";
import { CredentialsPrompt } from "./credentials-prompt";
import { credentialsRequestOf } from "./host-prompt";
import { useAutoReconnect } from "./use-auto-reconnect";
import { useHostSession, type HostSessionState } from "./use-host-session";

interface HostSessionViewProps {
  host: HostView;
  onStatusChange?: (status: TabStatus) => void;
  onSizeChange?: (size: TerminalSize) => void;
  /** Opens an SFTP tab to the same host. */
  onOpenSftp?: (host: HostView) => void;
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

export function HostSessionView({ host, onStatusChange, onSizeChange, onOpenSftp }: HostSessionViewProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const getTerminal = useCallback(() => terminalRef.current, []);
  const session = useHostSession(host, getTerminal);
  const { state } = session;
  const endpoint = `${host.hostname}:${host.port}`;
  const credentials = credentialsRequestOf(state);
  const waitingToRetry = session.recovering && (state.phase === "closed" || state.phase === "error");
  const auto = useAutoReconnect(waitingToRetry, state.phase === "connected", session.reconnect);
  const dimmed = session.everConnected && state.phase !== "connected";
  const aiAllowed = useAiAllowed(host);
  const [aiOpen, setAiOpen] = useState(false);
  const closeAi = () => {
    setAiOpen(false);
    terminalRef.current?.focus();
  };

  useEffect(() => {
    onStatusChange?.(tabStatusOf[state.phase]);
  }, [state.phase, onStatusChange]);

  // Each (re)connection starts the host's auto-start forwards that are not already running.
  const connected = state.phase === "connected";
  useEffect(() => {
    if (connected) void useForwardsStore.getState().autoStart(host.id);
  }, [connected, host.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="font-medium">{host.label}</span>
        <span className="font-mono text-xs text-fg-muted">
          {host.username ? `${host.username}@` : ""}
          {endpoint}
        </span>
        <div className="ml-auto flex gap-2">
          {state.phase === "connected" && aiAllowed && (
            <Button size="sm" variant="outline" title={`Ask AI for a command (${aiShortcutLabel(isMacPlatform())})`} onClick={() => setAiOpen(true)}>
              <Sparkles size={14} /> AI
            </Button>
          )}
          {state.phase === "connected" && onOpenSftp && (
            <Button size="sm" variant="outline" title="Browse files on this host" onClick={() => onOpenSftp(host)}>
              <FolderTree size={14} /> SFTP
            </Button>
          )}
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
          onAskAi={aiAllowed ? () => setAiOpen(true) : undefined}
          onResize={(size) => {
            session.resize(size);
            onSizeChange?.(size);
          }}
        />
        {dimmed && <div aria-hidden className="pointer-events-none absolute inset-0 bg-bg/45" />}
        {aiOpen && aiAllowed && <AiCommandBar target="remote" hostId={host.id} onInsert={session.send} onClose={closeAi} />}
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
          onTrust={(remember) => session.trustHostKey(state.fingerprint, remember)}
          onCancel={session.cancel}
        />
      )}
    </div>
  );
}

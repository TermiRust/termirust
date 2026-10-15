import { FolderTree, PlugZap, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import type { HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { EnvironmentBadge } from "@/components/ui/environment-badge";
import { OsIcon } from "@/components/ui/os-icon";
import { useAiAllowed } from "@/features/ai/use-ai-allowed";
import { useDialogsStore } from "@/stores/dialogs-store";
import { useHostsStore } from "@/stores/hosts-store";
import { useTerminalAi } from "@/features/ai/use-terminal-ai";
import { aiShortcutLabel, isMacPlatform } from "@/lib/shortcuts";
import { TerminalView, type TerminalHandle, type TerminalSize } from "@/features/terminal/terminal-view";
import { useForwardsStore } from "@/stores/forwards-store";
import { broadcastToTab, registerPaneInput, registerTerminalInput } from "@/stores/terminal-inputs";
import type { TabStatus } from "@/stores/tabs-store";

import { EnvironmentWatermark } from "./environment-watermark";
import { HostKeyDialog } from "./host-key-dialog";
import { ConnectPanel } from "./connect-progress";
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
  /** False for a pane that is not the tab's focused one; it then stays out of the input routing. */
  focused?: boolean;
  /** This pane's id inside the tab, so broadcast input can reach it. */
  paneId?: string;
  /** Keystrokes typed here go to every pane of the tab. */
  broadcast?: boolean;
  /** Lets snippets type into this tab while it is connected. */
  tabId?: string;
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

export function HostSessionView({ host, onStatusChange, onSizeChange, onOpenSftp, tabId, paneId, broadcast = false, focused = true }: HostSessionViewProps) {
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
  // The OS is learned on first connect; show it from the refreshed host list.
  const latestHost = useHostsStore((s) => s.hosts.find((h) => h.id === host.id)) ?? host;
  const openHostEditor = useDialogsStore((s) => s.openHostEditor);
  const ai = useTerminalAi({
    allowed: aiAllowed,
    target: "remote",
    hostId: host.id,
    hostLabel: host.label,
    insert: session.send,
    focusTerminal: () => terminalRef.current?.focus(),
    readScreen: () => terminalRef.current?.screenExcerpt() ?? null,
  });

  useEffect(() => {
    onStatusChange?.(tabStatusOf[state.phase]);
  }, [state.phase, onStatusChange]);

  // Each (re)connection starts the host's auto-start forwards that are not already running.
  const connected = state.phase === "connected";
  useEffect(() => {
    if (connected) void useForwardsStore.getState().autoStart(host.id);
  }, [connected, host.id]);

  // The backend records the OS during the first connection; pick it up for the icon.
  const knownOs = Boolean(latestHost.os);
  useEffect(() => {
    if (connected && !knownOs && useHostsStore.getState().loaded) void useHostsStore.getState().load();
  }, [connected, knownOs]);

  useEffect(() => (connected && focused && tabId ? registerTerminalInput(tabId, session.send) : undefined), [connected, focused, tabId, session.send]);
  useEffect(() => (connected && tabId && paneId ? registerPaneInput(tabId, paneId, session.send) : undefined), [connected, tabId, paneId, session.send]);
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
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <OsIcon os={latestHost.os} size={14} />
        <span className="font-medium">{host.label}</span>
        <EnvironmentBadge environment={latestHost.environment} />
        <span className="font-mono text-xs text-fg-muted">
          {host.username ? `${host.username}@` : ""}
          {endpoint}
        </span>
        <div className="ml-auto flex gap-2">
          {state.phase === "connected" && aiAllowed && (
            <Button size="sm" variant="outline" title={`Ask AI (${aiShortcutLabel(isMacPlatform())})`} onClick={ai.openPanel}>
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

      {/* Before the first connection the step panel explains everything; afterwards the banner. */}
      {(session.everConnected || session.recovering) && (
        <ConnectionBanner state={state} recovering={session.recovering} auto={auto} onReconnect={session.reconnect} />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-hidden" onContextMenu={(e) => ai.onContextMenu(e, terminalRef.current?.selectionExcerpt() ?? null)}>
          {!session.everConnected && state.phase !== "connected" && (
            <ConnectPanel
              title={state.phase === "error" || state.phase === "cancelled" ? `Could not connect to ${host.label}` : `Connecting to ${host.label}`}
              trace={session.trace}
              proxyHint={Boolean(latestHost.proxyCommand)}
              onRetry={session.reconnect}
              onEditHost={() => openHostEditor(latestHost)}
            />
          )}
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
          <EnvironmentWatermark environment={latestHost.environment} />
          {dimmed && <div aria-hidden className="pointer-events-none absolute inset-0 bg-bg/45" />}
        </div>
        {ai.panel}
      </div>
      {ai.contextMenu}

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

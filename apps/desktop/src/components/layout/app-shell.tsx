import { useCallback, useEffect, useMemo, useState } from "react";

import { commands, type HostView, type SnippetView } from "@/bindings";
import { AppDialogs } from "@/components/layout/app-dialogs";
import { ConfirmCloseDialog } from "@/components/layout/confirm-close-dialog";
import { EmptyWorkspace } from "@/components/layout/empty-workspace";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { ConnectionLab } from "@/features/connection-lab/connection-lab";
import { ForwardsView } from "@/features/forwards/forwards-view";
import { KeychainView } from "@/features/keychain/keychain-view";
import { SettingsView } from "@/features/settings/settings-view";
import { MultiHostRunDialog } from "@/features/snippets/multi-host-run-dialog";
import { SnippetRunDialog } from "@/features/snippets/snippet-run-dialog";
import { SnippetsView } from "@/features/snippets/snippets-view";
import { CommandPalette, type PaletteCommand } from "@/features/palette/command-palette";
import { paletteIcons } from "@/features/palette/palette-icons";
import { HostSessionView } from "@/features/session/host-session-view";
import { LocalSessionView } from "@/features/session/local-session-view";
import { SftpView } from "@/features/sftp/sftp-view";
import { resolveTabColor, tabColorVar } from "@/features/tabs/tab-color";
import { appShortcut, isMacPlatform, isToggleSidebarShortcut, paneShortcut, shortcutLabel, tabShortcut } from "@/lib/shortcuts";
import { paneIds } from "@/features/panes/pane-tree";
import { PaneLayout } from "@/components/layout/pane-layout";
import { useAppVersion } from "@/lib/use-app-version";
import { cn } from "@/lib/utils";
import { useAiStore } from "@/stores/ai-store";
import { useSnippetsStore } from "@/stores/snippets-store";
import { sendToTerminal, sendWhenReady } from "@/stores/terminal-inputs";
import { useDialogsStore } from "@/stores/dialogs-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useHostsStore } from "@/stores/hosts-store";
import { useLayoutStore } from "@/stores/layout-store";
import { loadRecentHostIds, rememberRecentHost } from "@/stores/recent-hosts";
import { useTabsStore, type Tab, type TabStatus } from "@/stores/tabs-store";

export function AppShell() {
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const section = useLayoutStore((s) => s.section);
  const setSection = useLayoutStore((s) => s.setSection);
  const loadHosts = useHostsStore((s) => s.load);
  const groups = useHostsStore((s) => s.groups);
  const hosts = useHostsStore((s) => s.hosts);
  const { paletteOpen, setPaletteOpen, openNewHost, setImportConfigOpen } = useDialogsStore();
  const [recentHostIds, setRecentHostIds] = useState<string[]>(loadRecentHostIds);
  const { tabs, activeTabId, openHostTab, openSftpTab, openLabTab, openLocalTab, closeTab, activateTabAt, setTabStatus, setTabSize } = useTabsStore();
  const showStatusBar = useSettingsStore((s) => s.terminal.showStatusBar);
  const version = useAppVersion();
  const onMac = useMemo(() => isMacPlatform(), []);
  const autoRunBenchmarks = import.meta.env.VITE_AUTORUN_BENCHMARK === "1";
  const [closing, setClosing] = useState<{ tab: Tab; paneId: string | null } | null>(null);

  const loadSettings = useSettingsStore((s) => s.load);
  const loadAi = useAiStore((s) => s.load);
  const loadSnippets = useSnippetsStore((s) => s.load);
  const snippets = useSnippetsStore((s) => s.snippets);
  useEffect(() => {
    void loadHosts();
    void loadSettings();
    void loadAi();
    void loadSnippets();
  }, [loadHosts, loadSettings, loadAi, loadSnippets]);

  const [snippetRun, setSnippetRun] = useState<{ snippet: SnippetView; tab: Tab } | null>(null);
  const [multiRun, setMultiRun] = useState<SnippetView | null>(null);
  const runOnHosts = useCallback(
    (targets: HostView[], keystrokes: string) => {
      setSection("hosts");
      for (const host of targets) {
        const tabId = openHostTab(host, resolveTabColor(host, groups.find((g) => g.id === host.groupId)));
        sendWhenReady(tabId, keystrokes);
      }
    },
    [groups, openHostTab, setSection],
  );
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const terminalReady = activeTab !== undefined && activeTab.status === "connected" && (activeTab.target.kind === "host" || activeTab.target.kind === "local");
  const runSnippet = useCallback(
    (snippet: SnippetView) => {
      const { tabs: current, activeTabId: activeId } = useTabsStore.getState();
      const tab = current.find((t) => t.id === activeId);
      if (!tab || tab.status !== "connected" || (tab.target.kind !== "host" && tab.target.kind !== "local")) {
        setSection("snippets");
        return;
      }
      setSection("hosts");
      setSnippetRun({ snippet, tab });
    },
    [setSection],
  );

  useEffect(() => {
    if (autoRunBenchmarks && useTabsStore.getState().tabs.length === 0) openLabTab();
  }, [autoRunBenchmarks, openLabTab]);

  const openHost = useCallback(
    (host: HostView) => {
      setSection("hosts");
      setRecentHostIds(rememberRecentHost(host.id));
      openHostTab(host, resolveTabColor(host, groups.find((g) => g.id === host.groupId)));
    },
    [groups, openHostTab, setSection],
  );

  const openSftp = useCallback(
    (host: HostView) => {
      setSection("hosts");
      openSftpTab(host, resolveTabColor(host, groups.find((g) => g.id === host.groupId)));
    },
    [groups, openSftpTab, setSection],
  );

  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      { id: "new-host", label: "New host", icon: paletteIcons.newHost, shortcut: shortcutLabel("newHost", onMac), run: openNewHost },
      {
        id: "new-local",
        label: "New local terminal",
        icon: paletteIcons.newLocal,
        shortcut: shortcutLabel("newLocal", onMac),
        run: () => {
          setSection("hosts");
          openLocalTab();
        },
      },
      { id: "import-config", label: "Import from SSH config", icon: paletteIcons.importConfig, run: () => setImportConfigOpen(true) },
      { id: "keychain", label: "Open Keychain", icon: paletteIcons.keychain, run: () => setSection("keychain") },
      { id: "snippets", label: "Open Snippets", icon: paletteIcons.snippets, run: () => setSection("snippets") },
      { id: "forwards", label: "Open Port forwarding", icon: paletteIcons.forwards, run: () => setSection("forwards") },
      { id: "settings", label: "Open Settings", icon: paletteIcons.settings, run: () => setSection("settings") },
      { id: "logs", label: "Open log folder", icon: paletteIcons.logs, run: () => void commands.logsOpenFolder() },
      {
        id: "broadcast",
        label: "Toggle broadcast input (split tab)",
        icon: paletteIcons.broadcast,
        run: () => {
          const { activeTabId: activeId, toggleBroadcast } = useTabsStore.getState();
          if (activeId) toggleBroadcast(activeId);
        },
      },
      { id: "sidebar", label: "Toggle sidebar", icon: paletteIcons.sidebar, shortcut: shortcutLabel("sidebar", onMac), run: toggleSidebar },
    ],
    [onMac, openNewHost, openLocalTab, setImportConfigOpen, setSection, toggleSidebar],
  );

  const requestClose = useCallback(
    (tab: Tab) => {
      if (tab.status === "connected") setClosing({ tab, paneId: null });
      else closeTab(tab.id);
    },
    [closeTab],
  );

  /** ⌘W closes the focused pane of a split tab, or the tab when only one pane is left. */
  const requestCloseFocused = useCallback(
    (tab: Tab) => {
      if (paneIds(tab.layout).length <= 1) {
        requestClose(tab);
        return;
      }
      if (tab.paneStatus[tab.focusedPaneId] === "connected") setClosing({ tab, paneId: tab.focusedPaneId });
      else useTabsStore.getState().closePane(tab.id, tab.focusedPaneId);
    },
    [requestClose],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isToggleSidebarShortcut(event, onMac)) {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      const app = appShortcut(event, onMac);
      if (app) {
        event.preventDefault();
        if (app === "palette") setPaletteOpen(!useDialogsStore.getState().paletteOpen);
        else openNewHost();
        return;
      }
      const pane = paneShortcut(event, onMac);
      if (pane) {
        event.preventDefault();
        const { activeTabId: activeId, splitPane, focusNeighbour } = useTabsStore.getState();
        if (!activeId) return;
        if (pane.action === "split") splitPane(activeId, pane.direction);
        else focusNeighbour(activeId, pane.direction);
        return;
      }
      const shortcut = tabShortcut(event, onMac);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut.action === "select") {
        activateTabAt(shortcut.index);
      } else if (shortcut.action === "newLocal") {
        setSection("hosts");
        openLocalTab();
      } else {
        const { tabs: current, activeTabId: activeId } = useTabsStore.getState();
        const active = current.find((t) => t.id === activeId);
        if (active) requestCloseFocused(active);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onMac, toggleSidebar, activateTabAt, requestCloseFocused, openLocalTab, setSection, setPaletteOpen, openNewHost]);

  return (
    <div className="flex h-full">
      {sidebarVisible && <Sidebar onOpenHost={openHost} onOpenSftp={openSftp} />}
      <main className="flex min-w-0 flex-1 flex-col">
        {section === "keychain" && <KeychainView />}
        {section === "snippets" && <SnippetsView onUse={terminalReady ? runSnippet : undefined} onRunOnHosts={hosts.length > 0 ? setMultiRun : undefined} />}
        {section === "forwards" && <ForwardsView />}
        {section === "settings" && <SettingsView />}
        {section === "hosts" && tabs.length > 0 && <TabBar onRequestClose={requestClose} onNewLocalTab={openLocalTab} />}
        {section === "hosts" && tabs.length === 0 && (
          <EmptyWorkspace
            version={version}
            shortcuts={{
              palette: shortcutLabel("palette", onMac),
              newHost: shortcutLabel("newHost", onMac),
              newLocal: shortcutLabel("newLocal", onMac),
              sidebar: shortcutLabel("sidebar", onMac),
            }}
            onNewHost={openNewHost}
            onImportConfig={() => setImportConfigOpen(true)}
            onOpenLocal={openLocalTab}
            onOpenConnectionLab={import.meta.env.DEV ? openLabTab : undefined}
          />
        )}
        {tabs.map((tab) => (
          <TabPanel
            key={tab.id}
            tab={tab}
            active={section === "hosts" && tab.id === activeTabId}
            onStatusChange={setTabStatus}
            onSizeChange={setTabSize}
            onClose={closeTab}
            onOpenSftp={openSftp}
            autoRunBenchmarks={autoRunBenchmarks}
            warningBorder={
              tab.target.kind !== "local" && tab.target.kind !== "lab" && tab.color !== null && groupWarns(groups, tab.target.host.groupId) ? tabColorVar[tab.color] : null
            }
          />
        ))}
        {section === "hosts" && showStatusBar && <StatusBar tab={tabs.find((t) => t.id === activeTabId)} hosts={hosts} />}
      </main>
      <AppDialogs onConnect={openHost} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        hosts={hosts}
        recentHostIds={recentHostIds}
        commands={paletteCommands}
        onOpenHost={openHost}
        onOpenSftp={openSftp}
        snippets={snippets}
        onRunSnippet={runSnippet}
      />
      {multiRun && <MultiHostRunDialog snippet={multiRun} onRun={runOnHosts} onClose={() => setMultiRun(null)} />}
      {snippetRun && (
        <SnippetRunDialog
          snippet={snippetRun.snippet}
          targetLabel={snippetRun.tab.title}
          onSend={(keys) => sendToTerminal(snippetRun.tab.id, keys)}
          onClose={() => setSnippetRun(null)}
        />
      )}
      {closing && (
        <ConfirmCloseDialog
          title={closing.paneId ? `this pane of ${closing.tab.title}` : closing.tab.title}
          onCancel={() => setClosing(null)}
          onConfirm={() => {
            if (closing.paneId) useTabsStore.getState().closePane(closing.tab.id, closing.paneId);
            else closeTab(closing.tab.id);
            setClosing(null);
          }}
        />
      )}
    </div>
  );
}

interface TabPanelProps {
  tab: Tab;
  active: boolean;
  onStatusChange: (id: string, status: TabStatus) => void;
  onSizeChange: (id: string, cols: number, rows: number) => void;
  onClose: (id: string) => void;
  onOpenSftp: (host: HostView) => void;
  autoRunBenchmarks: boolean;
  /** CSS colour of the warning frame, or null when the host's group does not ask for one. */
  warningBorder: string | null;
}

function groupWarns(groups: { id: string; warningBorder: boolean }[], groupId: string | null): boolean {
  return groupId !== null && groups.some((g) => g.id === groupId && g.warningBorder);
}

/** Inactive tabs stay mounted (hidden) so their SSH sessions and scrollback survive switching. */
function TabPanel({ tab, active, onStatusChange, onSizeChange, onClose, onOpenSftp, autoRunBenchmarks, warningBorder }: TabPanelProps) {
  const reportStatus = useCallback((status: TabStatus) => onStatusChange(tab.id, status), [onStatusChange, tab.id]);
  const reportSize = useCallback((size: { cols: number; rows: number }) => onSizeChange(tab.id, size.cols, size.rows), [onSizeChange, tab.id]);
  return (
    <div
      role="tabpanel"
      aria-labelledby={`tab-${tab.id}`}
      hidden={!active}
      data-warning-border={warningBorder ? "true" : undefined}
      className={active ? "flex min-h-0 flex-1 flex-col" : undefined}
      style={warningBorder ? { boxShadow: `inset 0 0 0 2px ${warningBorder}` } : undefined}
    >
      {(tab.target.kind === "host" || tab.target.kind === "local") && paneIds(tab.layout).length > 1 && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-bg-sunk px-2 text-[11px] text-fg-muted">
          <span>{paneIds(tab.layout).length} panes</span>
          <button
            type="button"
            aria-pressed={tab.broadcast}
            onClick={() => useTabsStore.getState().toggleBroadcast(tab.id)}
            className={cn("rounded border px-1.5 py-0.5", tab.broadcast ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-hover")}
          >
            Broadcast input
          </button>
          {tab.broadcast && (
            <span role="status" className="font-semibold text-accent">
              Broadcast — what you type goes to all {paneIds(tab.layout).length} panes
            </span>
          )}
        </div>
      )}
      {tab.target.kind === "host" || tab.target.kind === "local" ? (
        <PaneLayout
          layout={tab.layout}
          focusedPaneId={tab.focusedPaneId}
          broadcast={tab.broadcast}
          onFocusPane={(paneId) => useTabsStore.getState().focusPane(tab.id, paneId)}
          onResize={(splitId, ratio) => useTabsStore.getState().setSplitRatio(tab.id, splitId, ratio)}
          renderPane={(paneId, focused, multiple) => {
            const status = (s: TabStatus) => useTabsStore.getState().setPaneStatus(tab.id, paneId, s);
            const size = focused ? reportSize : undefined;
            return tab.target.kind === "host" ? (
              <HostSessionView
                host={tab.target.host}
                onStatusChange={status}
                onSizeChange={size}
                onOpenSftp={onOpenSftp}
                tabId={tab.id}
                paneId={paneId}
                broadcast={tab.broadcast}
                focused={focused}
              />
            ) : (
              <LocalSessionView
                onStatusChange={status}
                onSizeChange={size}
                tabId={tab.id}
                paneId={paneId}
                broadcast={tab.broadcast}
                focused={focused}
                title={multiple ? "Local" : undefined}
              />
            );
          }}
        />
      ) : tab.target.kind === "sftp" ? (
        <SftpView host={tab.target.host} onStatusChange={reportStatus} />
      ) : (
        <ConnectionLab onExit={() => onClose(tab.id)} autoRunBenchmarks={autoRunBenchmarks} />
      )}
    </div>
  );
}

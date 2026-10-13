import { useCallback, useEffect, useMemo, useState } from "react";

import { commands, type HostView } from "@/bindings";
import { AppDialogs } from "@/components/layout/app-dialogs";
import { ConfirmCloseDialog } from "@/components/layout/confirm-close-dialog";
import { EmptyWorkspace } from "@/components/layout/empty-workspace";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { ConnectionLab } from "@/features/connection-lab/connection-lab";
import { KeychainView } from "@/features/keychain/keychain-view";
import { SettingsView } from "@/features/settings/settings-view";
import { CommandPalette, type PaletteCommand } from "@/features/palette/command-palette";
import { paletteIcons } from "@/features/palette/palette-icons";
import { HostSessionView } from "@/features/session/host-session-view";
import { LocalSessionView } from "@/features/session/local-session-view";
import { SftpView } from "@/features/sftp/sftp-view";
import { resolveTabColor, tabColorVar } from "@/features/tabs/tab-color";
import { appShortcut, isMacPlatform, isToggleSidebarShortcut, shortcutLabel, tabShortcut } from "@/lib/shortcuts";
import { useAppVersion } from "@/lib/use-app-version";
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
  const [closing, setClosing] = useState<Tab | null>(null);

  const loadSettings = useSettingsStore((s) => s.load);
  useEffect(() => {
    void loadHosts();
    void loadSettings();
  }, [loadHosts, loadSettings]);

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
      { id: "settings", label: "Open Settings", icon: paletteIcons.settings, run: () => setSection("settings") },
      { id: "logs", label: "Open log folder", icon: paletteIcons.logs, run: () => void commands.logsOpenFolder() },
      { id: "sidebar", label: "Toggle sidebar", icon: paletteIcons.sidebar, shortcut: shortcutLabel("sidebar", onMac), run: toggleSidebar },
    ],
    [onMac, openNewHost, openLocalTab, setImportConfigOpen, setSection, toggleSidebar],
  );

  const requestClose = useCallback(
    (tab: Tab) => {
      if (tab.status === "connected") setClosing(tab);
      else closeTab(tab.id);
    },
    [closeTab],
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
        if (active) requestClose(active);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onMac, toggleSidebar, activateTabAt, requestClose, openLocalTab, setSection, setPaletteOpen, openNewHost]);

  return (
    <div className="flex h-full">
      {sidebarVisible && <Sidebar onOpenHost={openHost} onOpenSftp={openSftp} />}
      <main className="flex min-w-0 flex-1 flex-col">
        {section === "keychain" && <KeychainView />}
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
      />
      {closing && (
        <ConfirmCloseDialog
          title={closing.title}
          onCancel={() => setClosing(null)}
          onConfirm={() => {
            closeTab(closing.id);
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
      {tab.target.kind === "host" ? (
        <HostSessionView host={tab.target.host} onStatusChange={reportStatus} onSizeChange={reportSize} onOpenSftp={onOpenSftp} />
      ) : tab.target.kind === "sftp" ? (
        <SftpView host={tab.target.host} onStatusChange={reportStatus} />
      ) : tab.target.kind === "local" ? (
        <LocalSessionView onStatusChange={reportStatus} onSizeChange={reportSize} />
      ) : (
        <ConnectionLab onExit={() => onClose(tab.id)} autoRunBenchmarks={autoRunBenchmarks} />
      )}
    </div>
  );
}

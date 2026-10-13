import { useCallback, useEffect, useMemo, useState } from "react";

import type { HostView } from "@/bindings";
import { ConfirmCloseDialog } from "@/components/layout/confirm-close-dialog";
import { EmptyWorkspace } from "@/components/layout/empty-workspace";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { ConnectionLab } from "@/features/connection-lab/connection-lab";
import { KeychainView } from "@/features/keychain/keychain-view";
import { HostSessionView } from "@/features/session/host-session-view";
import { LocalSessionView } from "@/features/session/local-session-view";
import { groupTabColor } from "@/features/tabs/tab-color";
import { isMacPlatform, isToggleSidebarShortcut, tabShortcut, toggleSidebarLabel } from "@/lib/shortcuts";
import { useAppVersion } from "@/lib/use-app-version";
import { useHostsStore } from "@/stores/hosts-store";
import { useLayoutStore } from "@/stores/layout-store";
import { useTabsStore, type Tab, type TabStatus } from "@/stores/tabs-store";

export function AppShell() {
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const section = useLayoutStore((s) => s.section);
  const setSection = useLayoutStore((s) => s.setSection);
  const loadHosts = useHostsStore((s) => s.load);
  const groups = useHostsStore((s) => s.groups);
  const { tabs, activeTabId, openHostTab, openLabTab, openLocalTab, closeTab, activateTabAt, setTabStatus } = useTabsStore();
  const version = useAppVersion();
  const onMac = useMemo(() => isMacPlatform(), []);
  const autoRunBenchmarks = import.meta.env.VITE_AUTORUN_BENCHMARK === "1";
  const [closing, setClosing] = useState<Tab | null>(null);

  useEffect(() => {
    void loadHosts();
  }, [loadHosts]);

  useEffect(() => {
    if (autoRunBenchmarks && useTabsStore.getState().tabs.length === 0) openLabTab();
  }, [autoRunBenchmarks, openLabTab]);

  const openHost = useCallback(
    (host: HostView) => openHostTab(host, groupTabColor(groups.find((g) => g.id === host.groupId))),
    [groups, openHostTab],
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
  }, [onMac, toggleSidebar, activateTabAt, requestClose, openLocalTab, setSection]);

  return (
    <div className="flex h-full">
      {sidebarVisible && <Sidebar onOpenHost={openHost} />}
      <main className="flex min-w-0 flex-1 flex-col">
        {section === "keychain" && <KeychainView />}
        {section === "hosts" && tabs.length > 0 && <TabBar onRequestClose={requestClose} onNewLocalTab={openLocalTab} />}
        {section === "hosts" && tabs.length === 0 && (
          <EmptyWorkspace version={version} sidebarShortcut={toggleSidebarLabel(onMac)} onOpenConnectionLab={openLabTab} />
        )}
        {tabs.map((tab) => (
          <TabPanel key={tab.id} tab={tab} active={section === "hosts" && tab.id === activeTabId} onStatusChange={setTabStatus} onClose={closeTab} autoRunBenchmarks={autoRunBenchmarks} />
        ))}
      </main>
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
  onClose: (id: string) => void;
  autoRunBenchmarks: boolean;
}

/** Inactive tabs stay mounted (hidden) so their SSH sessions and scrollback survive switching. */
function TabPanel({ tab, active, onStatusChange, onClose, autoRunBenchmarks }: TabPanelProps) {
  const reportStatus = useCallback((status: TabStatus) => onStatusChange(tab.id, status), [onStatusChange, tab.id]);
  return (
    <div role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={!active} className={active ? "flex min-h-0 flex-1 flex-col" : undefined}>
      {tab.target.kind === "host" ? (
        <HostSessionView host={tab.target.host} onStatusChange={reportStatus} />
      ) : tab.target.kind === "local" ? (
        <LocalSessionView onStatusChange={reportStatus} />
      ) : (
        <ConnectionLab onExit={() => onClose(tab.id)} autoRunBenchmarks={autoRunBenchmarks} />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";

import type { HostView } from "@/bindings";

import { EmptyWorkspace } from "@/components/layout/empty-workspace";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { ConnectionLab } from "@/features/connection-lab/connection-lab";
import { HostSessionView } from "@/features/session/host-session-view";
import { isMacPlatform, isToggleSidebarShortcut, toggleSidebarLabel } from "@/lib/shortcuts";
import { useAppVersion } from "@/lib/use-app-version";
import { useHostsStore } from "@/stores/hosts-store";
import { useLayoutStore } from "@/stores/layout-store";

export function AppShell() {
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const version = useAppVersion();
  const onMac = useMemo(() => isMacPlatform(), []);
  const autoRunBenchmarks = import.meta.env.VITE_AUTORUN_BENCHMARK === "1";
  const [view, setView] = useState<"empty" | "lab" | "host">(autoRunBenchmarks ? "lab" : "empty");
  const [activeHost, setActiveHost] = useState<{ host: HostView; attempt: number } | null>(null);
  const loadHosts = useHostsStore((s) => s.load);

  useEffect(() => {
    void loadHosts();
  }, [loadHosts]);

  const openHost = (host: HostView) => {
    setActiveHost((current) => ({ host, attempt: (current?.attempt ?? 0) + 1 }));
    setView("host");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isToggleSidebarShortcut(event, onMac)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onMac, toggleSidebar]);

  return (
    <div className="flex h-full">
      {sidebarVisible && <Sidebar onOpenHost={openHost} />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        {view === "host" && activeHost ? (
          <HostSessionView
            key={`${activeHost.host.id}:${activeHost.attempt}`}
            host={activeHost.host}
            onExit={() => {
              setView("empty");
              setActiveHost(null);
            }}
          />
        ) : view === "lab" ? (
          <ConnectionLab onExit={() => setView("empty")} autoRunBenchmarks={autoRunBenchmarks} />
        ) : (
          <EmptyWorkspace
            version={version}
            sidebarShortcut={toggleSidebarLabel(onMac)}
            onOpenConnectionLab={() => setView("lab")}
          />
        )}
      </main>
    </div>
  );
}

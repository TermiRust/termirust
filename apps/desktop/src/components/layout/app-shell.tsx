import { useEffect, useMemo } from "react";

import { EmptyWorkspace } from "@/components/layout/empty-workspace";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { isMacPlatform, isToggleSidebarShortcut, toggleSidebarLabel } from "@/lib/shortcuts";
import { useAppVersion } from "@/lib/use-app-version";
import { useLayoutStore } from "@/stores/layout-store";

export function AppShell() {
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const version = useAppVersion();
  const onMac = useMemo(() => isMacPlatform(), []);

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
      {sidebarVisible && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <EmptyWorkspace version={version} sidebarShortcut={toggleSidebarLabel(onMac)} />
      </main>
    </div>
  );
}

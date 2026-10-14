import { Activity, FolderTree, KeyRound, Lock, Plus, Server, SquareCode, SquareTerminal, Waypoints, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { isMacPlatform, shortcutLabel } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useDialogsStore } from "@/stores/dialogs-store";
import { useHostsStore } from "@/stores/hosts-store";
import { useLayoutStore, type Section } from "@/stores/layout-store";
import { useTabsStore } from "@/stores/tabs-store";

const ITEMS: { section: Section; label: string; icon: LucideIcon }[] = [
  { section: "library", label: "Hosts", icon: Server },
  { section: "hosts", label: "Terminals", icon: SquareTerminal },
  { section: "sftp", label: "SFTP", icon: FolderTree },
  { section: "monitor", label: "Monitor", icon: Activity },
  { section: "snippets", label: "Snippets", icon: SquareCode },
  { section: "forwards", label: "Port forwarding", icon: Waypoints },
  { section: "keychain", label: "Keychain", icon: KeyRound },
];

/** The app's sections. Hosts and groups are managed on the Hosts screen. */
export function Sidebar() {
  const section = useLayoutStore((s) => s.section);
  const setSection = useLayoutStore((s) => s.setSection);
  const { loaded, error, retryVault } = useHostsStore();
  const openNewHost = useDialogsStore((s) => s.openNewHost);
  const tabCount = useTabsStore((s) => s.tabs.length);

  return (
    <aside aria-label="Sidebar" className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-sunk">
      <nav aria-label="Sections" className="flex flex-col gap-0.5 p-2">
        {ITEMS.map(({ section: id, label, icon: Icon }) => (
          <Button key={id} className={cn("justify-start", section === id && "bg-active text-fg")} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
            <Icon size={15} /> {label}
            {id === "hosts" && tabCount > 0 && <span className="ml-auto rounded bg-bg-sunk-2 px-1.5 font-mono text-[11px] text-fg-muted">{tabCount}</span>}
          </Button>
        ))}
      </nav>

      <div className="flex-1 px-3">
        {!loaded && !error && (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
            <Lock size={13} className="animate-pulse" /> Unlocking vault…
          </p>
        )}
        {error && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => void retryVault()}>
              Try again
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-border p-2">
        <Button className="w-full justify-start" variant="outline" onClick={openNewHost}>
          <Plus size={15} /> New host
          <span aria-hidden className="ml-auto">
            <Kbd>{shortcutLabel("newHost", isMacPlatform())}</Kbd>
          </span>
        </Button>
      </div>
    </aside>
  );
}

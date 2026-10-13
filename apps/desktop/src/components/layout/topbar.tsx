import { PanelLeft, Search, SlidersHorizontal } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

interface TopbarProps {
  onMac: boolean;
  paletteShortcut: string;
  sidebarShortcut: string;
  settingsActive: boolean;
  onSearch: () => void;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
}

/**
 * The window's top strip from the mockup. On macOS it sits in the title bar next to the
 * traffic lights (overlay title bar), so empty space drags the window.
 */
export function Topbar({ onMac, paletteShortcut, sidebarShortcut, settingsActive, onSearch, onToggleSidebar, onOpenSettings }: TopbarProps) {
  return (
    <header
      data-tauri-drag-region
      aria-label="Top bar"
      className={cn("relative flex h-[38px] shrink-0 items-center gap-1 border-b border-border bg-bg-sunk pr-2 select-none", onMac ? "pl-[78px]" : "pl-2")}
    >
      <button
        type="button"
        aria-label="Toggle sidebar"
        title={`Toggle sidebar (${sidebarShortcut})`}
        onClick={onToggleSidebar}
        className="grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
      >
        <PanelLeft size={15} />
      </button>
      <button
        type="button"
        aria-label="Search hosts and commands"
        onClick={onSearch}
        className="absolute left-1/2 flex h-[26px] w-[min(340px,40vw)] -translate-x-1/2 items-center gap-2 rounded-[7px] border border-border bg-bg px-2.5 text-[12.5px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg-2"
      >
        <Search size={13} />
        <span className="flex-1 truncate text-left">Search hosts and commands…</span>
        <Kbd>{paletteShortcut}</Kbd>
      </button>
      <button
        type="button"
        aria-label="Settings"
        aria-pressed={settingsActive}
        title="Settings"
        onClick={onOpenSettings}
        className={cn("ml-auto grid h-7 w-7 place-items-center rounded-md hover:bg-hover hover:text-fg", settingsActive ? "bg-active text-fg" : "text-fg-muted")}
      >
        <SlidersHorizontal size={15} />
      </button>
    </header>
  );
}

import { PanelLeft, Search } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { WindowControls } from "@/components/layout/window-controls";
import { cn } from "@/lib/utils";

interface TopbarProps {
  onMac: boolean;
  /** Windows draws its own window buttons here (the native title bar is off). */
  windowControls?: boolean;
  paletteShortcut: string;
  sidebarShortcut: string;
  onSearch: () => void;
  onToggleSidebar: () => void;
}

/**
 * The window's top strip from the mockup. On macOS it sits in the title bar next to the
 * traffic lights (overlay title bar), so empty space drags the window.
 */
export function Topbar({ onMac, windowControls = false, paletteShortcut, sidebarShortcut, onSearch, onToggleSidebar }: TopbarProps) {
  return (
    <header
      data-tauri-drag-region
      aria-label="Top bar"
      className={cn("relative flex h-[38px] shrink-0 items-center gap-1 border-b border-border bg-bg-sunk select-none", onMac ? "pl-[78px]" : "pl-2", windowControls ? "pr-0" : "pr-2")}
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
        className="absolute inset-x-0 mx-auto flex h-[26px] w-[min(340px,40vw)] items-center gap-2 rounded-[7px] border border-border bg-bg px-2.5 text-[12.5px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg-2"
      >
        <Search size={13} />
        <span className="flex-1 truncate text-left">Search hosts and commands…</span>
        <Kbd>{paletteShortcut}</Kbd>
      </button>
      <span className="ml-auto" />
      {windowControls && <WindowControls />}
    </header>
  );
}

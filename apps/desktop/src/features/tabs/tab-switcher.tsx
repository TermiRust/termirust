import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FlaskConical, FolderTree, Search, SquareTerminal } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";

import { StatusDot } from "@/components/ui/status-dot";
import { dotForStatus } from "@/features/hosts/host-status";
import { cn } from "@/lib/utils";
import type { Tab } from "@/stores/tabs-store";

interface TabSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
}

const detail = (tab: Tab) => {
  if (tab.target.kind === "host" || tab.target.kind === "sftp") {
    const h = tab.target.host;
    return `${tab.target.kind === "sftp" ? "SFTP · " : ""}${h.username ? `${h.username}@` : ""}${h.hostname}`;
  }
  return tab.target.kind === "local" ? "Local shell" : "Connection lab";
};

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.target.kind === "local") return <SquareTerminal size={14} className="text-fg-muted" />;
  if (tab.target.kind === "lab") return <FlaskConical size={14} className="text-fg-muted" />;
  if (tab.target.kind === "sftp") return <FolderTree size={14} className="text-fg-muted" />;
  return <StatusDot state={dotForStatus(tab.status)} />;
}

/** A searchable list of every open tab, opened from the tab bar when tabs no longer fit. */
export function TabSwitcher({ open, onOpenChange, tabs, activeTabId, onSelect }: TabSwitcherProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="motion-overlay fixed inset-0 bg-scrim" />
        <DialogPrimitive.Content
          aria-label="Open tabs"
          className="motion-rise fixed inset-x-0 top-[14vh] mx-auto w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border bg-bg shadow-dialog"
        >
          <DialogPrimitive.Title className="sr-only">Open tabs</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search and switch between open tabs</DialogPrimitive.Description>
          <SwitcherBody
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={(id) => {
              onOpenChange(false);
              onSelect(id);
            }}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SwitcherBody({ tabs, activeTabId, onSelect }: { tabs: Tab[]; activeTabId: string | null; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return tabs.filter((t) => {
      const text = `${t.title} ${detail(t)}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [tabs, query]);
  const current = Math.min(cursor, Math.max(shown.length - 1, 0));

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (shown.length > 0) setCursor((current + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const tab = shown[current];
      if (tab) onSelect(tab.id);
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search size={15} className="text-fg-muted" />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="tab-switcher-results"
          aria-label="Search open tabs"
          aria-activedescendant={shown[current] ? `tab-switch-${current}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          placeholder={`Search ${tabs.length} open tabs…`}
          className="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-faint"
        />
      </div>
      <ul id="tab-switcher-results" role="listbox" aria-label="Tabs" className="max-h-[50vh] overflow-y-auto p-1.5">
        {shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-fg-muted">No tab matches “{query}”</li>}
        {shown.map((tab, index) => (
          <li
            key={tab.id}
            id={`tab-switch-${index}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setCursor(index)}
            onClick={() => onSelect(tab.id)}
            className={cn("flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px]", index === current && "bg-active")}
          >
            <span className="grid w-4 place-items-center">
              <TabIcon tab={tab} />
            </span>
            <span className="truncate">{tab.title}</span>
            <span className="truncate font-mono text-xs text-fg-muted">{detail(tab)}</span>
            {tab.id === activeTabId && <span className="ml-auto text-xs text-fg-muted">Current</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { ChevronDown, Columns2, FlaskConical, FolderTree, Plus, SquareTerminal, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { tabColorVar } from "@/features/tabs/tab-color";
import { isMacPlatform } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import { dotForStatus } from "@/features/hosts/host-status";
import { splitVisibleTabs, tabCapacity } from "@/features/tabs/tab-overflow";
import { TabSwitcher } from "@/features/tabs/tab-switcher";
import { splittable, useTabsStore, type Tab, type TabStatus } from "@/stores/tabs-store";

const statusLabel: Record<TabStatus, string> = {
  connecting: "connecting",
  connected: "connected",
  disconnected: "disconnected",
  error: "error",
  idle: "idle",
};

interface TabBarProps {
  onRequestClose: (tab: Tab) => void;
  onNewLocalTab: () => void;
  splitShortcut?: string;
}

const onMac = isMacPlatform();
/** "⌘1"… on macOS, "Alt+1"… elsewhere (ADR-015). */
const tabIndexLabel = (index: number) => `${onMac ? "⌘" : "Alt+"}${index + 1}`;

export function TabBar({ onRequestClose, onNewLocalTab, splitShortcut }: TabBarProps) {
  const { tabs, activeTabId, activateTab, renameTab, moveTab } = useTabsStore();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Tabs shrink to MIN_TAB_WIDTH; past that the rest go behind the overflow button.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(list.clientWidth));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  const { shown, hidden } = splitVisibleTabs(tabs, activeTabId, tabCapacity(width));

  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/x-termirust-tab") || dragging;
    if (id) moveTab(id, index);
    setDragging(null);
  };

  const onTabKeyDown = (event: KeyboardEvent, tab: Tab, index: number) => {
    if (event.key === "F2") {
      event.preventDefault();
      setRenaming(tab.id);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const next = tabs[index + (event.key === "ArrowRight" ? 1 : -1)];
      if (next) {
        activateTab(next.id);
        document.getElementById(`tab-${next.id}`)?.focus();
      }
    }
  };

  return (
    <div className="flex h-10 shrink-0 items-end gap-0.5 border-b border-border bg-bg-sunk px-2">
      <div ref={listRef} role="tablist" aria-label="Sessions" className="flex min-w-0 shrink items-end gap-0.5 overflow-hidden">
        {shown.map((tab) => {
          const index = tabs.indexOf(tab);
          const active = tab.id === activeTabId;
          const dim = tab.status === "disconnected" || tab.status === "error";
          return (
            <div
              key={tab.id}
              draggable={renaming !== tab.id}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/x-termirust-tab", tab.id);
                setDragging(tab.id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, index)}
              onDragEnd={() => setDragging(null)}
              className={cn(
                "group relative flex h-8 w-56 min-w-24 shrink items-center gap-2 rounded-t-md border border-b-0 pr-1 pl-3 text-[13px]",
                active ? "border-border bg-bg text-fg" : "border-transparent text-fg-muted hover:bg-hover",
                dragging === tab.id && "opacity-50",
              )}
            >
              {tab.color && (
                <span aria-hidden className="absolute top-1.5 bottom-1.5 left-1 w-0.5 rounded" style={{ background: tabColorVar[tab.color] }} />
              )}
              {active && <span aria-hidden className="absolute right-0 bottom-0 left-0 h-0.5 bg-accent" />}
              {renaming === tab.id ? (
                <input
                  aria-label="Tab name"
                  defaultValue={tab.title}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    renameTab(tab.id, e.currentTarget.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg-elev px-1 text-[13px] text-fg outline-none"
                />
              ) : (
                <button
                  id={`tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`${tab.title} (${statusLabel[tab.status]})`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => activateTab(tab.id)}
                  onDoubleClick={() => setRenaming(tab.id)}
                  onKeyDown={(e) => onTabKeyDown(e, tab, index)}
                  className={cn("flex min-w-0 flex-1 items-center gap-1.5 truncate text-left outline-offset-2", dim && "italic")}
                >
                  {tab.target.kind === "lab" ? (
                    <FlaskConical size={12} className="shrink-0" />
                  ) : tab.target.kind === "sftp" ? (
                    <FolderTree size={12} className="shrink-0 opacity-60" />
                  ) : tab.target.kind === "local" ? (
                    <SquareTerminal size={12} className="shrink-0 opacity-60" />
                  ) : dotForStatus(tab.status) === "err" ? (
                    <WifiOff size={12} aria-label="Disconnected" className="shrink-0 text-danger" />
                  ) : (
                    <StatusDot state={dotForStatus(tab.status)} className="h-[7px] w-[7px] shadow-none" />
                  )}
                  <span className="truncate">{tab.title}</span>
                  {index < 9 && <span className="ml-auto shrink-0 pl-1 font-mono text-[10.5px] text-fg-faint">{tabIndexLabel(index)}</span>}
                </button>
              )}
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                onClick={() => onRequestClose(tab)}
                className={cn("rounded p-0.5 text-fg-muted hover:bg-active hover:text-fg", active ? "visible" : "invisible group-hover:visible")}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      {hidden.length > 0 && (
        <Button
          size="sm"
          aria-label={`${hidden.length} more tab${hidden.length === 1 ? "" : "s"}`}
          title="All open tabs"
          onClick={() => setSwitcherOpen(true)}
          className="mb-1 shrink-0 gap-0.5 px-1.5 font-mono text-xs"
        >
          <ChevronDown size={14} />+{hidden.length}
        </Button>
      )}
      <Button size="icon" aria-label="New local terminal" title="New local terminal" onClick={onNewLocalTab} className="mb-1">
        <Plus size={15} />
      </Button>
      <Button
        size="icon"
        aria-label="Split pane"
        title={splitShortcut ? `Split pane (${splitShortcut})` : "Split pane"}
        disabled={!activeTab || !splittable(activeTab)}
        onClick={() => activeTab && useTabsStore.getState().splitPane(activeTab.id, "row")}
        className="mb-1"
      >
        <Columns2 size={15} />
      </Button>
      <TabSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} tabs={tabs} activeTabId={activeTabId} onSelect={activateTab} />
    </div>
  );
}

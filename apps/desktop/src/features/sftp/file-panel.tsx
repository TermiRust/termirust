import { ArrowUp, ChevronDown, ChevronUp, File, Folder, FolderPlus, Link2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { FileEntry } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { formatBytes, formatModified, formatPermissions } from "./format";
import { nextSelection, stepSelection } from "./selection";
import { DEFAULT_SORT, sortEntries, toggleSort, type SortKey, type SortOrder } from "./sort";

export interface FilePanelProps {
  side: "local" | "remote";
  title: string;
  path: string | null;
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  selected: string[];
  /** Highlights the panel while something dragged from the other side hovers over it. */
  dropTarget: boolean;
  isMac: boolean;
  onSelect: (paths: string[]) => void;
  onNavigate: (path: string) => void;
  onUp: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entries: FileEntry[]) => void;
  /** Double-click or Enter on a file: send it to the other side. */
  onOpenFile: (entry: FileEntry) => void;
  onRowPointerDown: (event: PointerEvent, entry: FileEntry) => void;
}

export function FilePanel(props: FilePanelProps) {
  const { side, title, path, loading, error, selected, dropTarget, isMac } = props;
  const [anchor, setAnchor] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOrder>(DEFAULT_SORT);
  const entries = useMemo(() => sortEntries(props.entries, sort), [props.entries, sort]);
  const paths = entries.map((e) => e.path);
  const selectedEntries = entries.filter((e) => selected.includes(e.path));

  const open = (entry: FileEntry) => {
    if (entry.kind === "directory" || entry.kind === "symlink") props.onNavigate(entry.path);
    else props.onOpenFile(entry);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const only = selectedEntries.length === 1 ? selectedEntries[0] : undefined;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const next = stepSelection(paths, selected, event.key === "ArrowDown" ? 1 : -1);
        props.onSelect(next);
        setAnchor(next[0] ?? null);
        break;
      }
      case "Enter":
        if (only) open(only);
        break;
      case "Backspace":
        // ⌘⌫ deletes as in Finder; a bare Backspace goes up a folder.
        if (event.metaKey && selectedEntries.length > 0) props.onDelete(selectedEntries);
        else props.onUp();
        break;
      case "Delete":
        if (selectedEntries.length > 0) props.onDelete(selectedEntries);
        break;
      case "F2":
        if (only) props.onRename(only);
        break;
      default:
        return;
    }
  };

  return (
    <section
      aria-label={`${title} files`}
      data-drop-side={side}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col border-border transition-shadow",
        dropTarget && "shadow-[inset_0_0_0_2px_var(--color-accent)]",
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="mr-1 shrink-0 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">{title}</span>
        <Button size="icon" aria-label={`Up one folder (${title})`} title="Up one folder" onClick={props.onUp} disabled={path === null}>
          <ArrowUp size={14} />
        </Button>
        <PathInput key={path ?? ""} title={title} path={path ?? ""} onNavigate={props.onNavigate} />
        <Button size="icon" aria-label={`Refresh ${title}`} title="Refresh" onClick={props.onRefresh} disabled={path === null}>
          <RefreshCw size={13} className={loading && path !== null ? "animate-spin" : undefined} />
        </Button>
        <Button size="icon" aria-label={`New folder (${title})`} title="New folder" onClick={props.onNewFolder} disabled={path === null}>
          <FolderPlus size={14} />
        </Button>
        <Button
          size="icon"
          aria-label={`Rename (${title})`}
          title="Rename (F2)"
          onClick={() => selectedEntries[0] && props.onRename(selectedEntries[0])}
          disabled={selectedEntries.length !== 1}
        >
          <Pencil size={13} />
        </Button>
        <Button
          size="icon"
          aria-label={`Delete (${title})`}
          title="Delete"
          onClick={() => props.onDelete(selectedEntries)}
          disabled={selectedEntries.length === 0}
        >
          <Trash2 size={13} />
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-[1fr_88px_160px] gap-3 border-b border-border bg-bg-sunk px-3 py-1.5 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        <SortHeader label="Name" column="name" sort={sort} onSort={setSort} />
        <SortHeader label="Size" column="size" sort={sort} onSort={setSort} className="justify-end" />
        <SortHeader label="Modified" column="modified" sort={sort} onSort={setSort} />
      </div>

      {error ? (
        <p role="alert" className="p-3 text-[13px] text-danger">
          {error}
        </p>
      ) : (
        <ul
          role="listbox"
          aria-label={`${title} folder contents`}
          aria-multiselectable
          aria-busy={loading}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto py-0.5 outline-none select-none focus-visible:bg-bg-elev/40"
        >
          {!loading && entries.length === 0 && <li className="px-3 py-2 text-[13px] text-fg-muted">This folder is empty.</li>}
          {entries.map((entry) => {
            const isSelected = selected.includes(entry.path);
            return (
              <li
                key={entry.path}
                role="option"
                aria-selected={isSelected}
                title={entry.permissions !== null ? `${entry.name} · ${formatPermissions(entry.permissions)}` : entry.name}
                onPointerDown={(e) => props.onRowPointerDown(e, entry)}
                onClick={(e) => {
                  const toggle = isMac ? e.metaKey : e.ctrlKey;
                  props.onSelect(nextSelection(paths, selected, anchor, entry.path, { toggle, range: e.shiftKey }));
                  if (!e.shiftKey) setAnchor(entry.path);
                }}
                onDoubleClick={() => open(entry)}
                className={cn(
                  "grid h-7 cursor-default grid-cols-[1fr_88px_160px] items-center gap-3 px-3 text-[13.5px] even:bg-bg-sunk/50",
                  isSelected ? "bg-accent/15 text-fg even:bg-accent/15" : "hover:bg-hover",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <EntryIcon kind={entry.kind} />
                  <span className="truncate">{entry.name}</span>
                </span>
                <span className="text-right font-mono text-[11px] text-fg-muted tabular-nums">
                  {entry.kind === "file" ? formatBytes(entry.size) : ""}
                </span>
                <span className="truncate text-[11px] text-fg-muted">{formatModified(entry.modified)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex h-6 shrink-0 items-center border-t border-border px-3 text-[11px] text-fg-muted">
        {selectedEntries.length > 0 ? `${selectedEntries.length} of ${entries.length} selected` : `${entries.length} items`}
      </div>
    </section>
  );
}

function SortHeader({ label, column, sort, onSort, className }: { label: string; column: SortKey; sort: SortOrder; onSort: (sort: SortOrder) => void; className?: string }) {
  const active = sort.key === column;
  return (
    <button
      type="button"
      aria-label={`Sort by ${label.toLowerCase()}`}
      aria-pressed={active}
      onClick={() => onSort(toggleSort(sort, column))}
      className={cn("flex items-center gap-0.5 text-left hover:text-fg", active && "text-fg-2", className)}
    >
      {label}
      {active && (sort.ascending ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
    </button>
  );
}

function EntryIcon({ kind }: { kind: FileEntry["kind"] }) {
  if (kind === "directory") return <Folder size={13} className="shrink-0 text-accent" />;
  if (kind === "symlink") return <Link2 size={13} className="shrink-0 text-fg-muted" />;
  return <File size={13} className="shrink-0 text-fg-muted" />;
}

/** Remounted on every navigation (keyed by path), so the draft always starts from the current path. */
function PathInput({ title, path, onNavigate }: { title: string; path: string; onNavigate: (path: string) => void }) {
  const [draft, setDraft] = useState(path);
  return (
    <Input
      aria-label={`${title} path`}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft.trim()) onNavigate(draft.trim());
        if (e.key === "Escape") setDraft(path);
      }}
      className="h-7 min-w-0 flex-1 font-mono text-xs"
    />
  );
}

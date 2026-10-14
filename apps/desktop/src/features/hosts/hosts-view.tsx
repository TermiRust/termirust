import { FileInput, FolderPlus, FolderTree, LayoutGrid, List, Pencil, Plus, Server, Terminal } from "lucide-react";
import { useMemo, useState, type PointerEvent } from "react";

import type { GroupView, HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { EnvironmentBadge } from "@/components/ui/environment-badge";
import { Input } from "@/components/ui/input";
import { OsIcon } from "@/components/ui/os-icon";
import { StatusDot } from "@/components/ui/status-dot";
import { osName } from "@/lib/os-catalog";
import { cn } from "@/lib/utils";
import { useDialogsStore } from "@/stores/dialogs-store";
import { useHostsStore } from "@/stores/hosts-store";
import { useTabsStore } from "@/stores/tabs-store";

import { GroupFormDialog } from "./group-form-dialog";
import { hostMatches } from "./host-tree";
import { hostDot } from "./host-status";
import { DROP_ATTR, useHostDrag } from "./use-host-drag";

type ViewMode = "grid" | "list";
const VIEW_KEY = "termirust.hosts.view";

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

interface HostsViewProps {
  onOpenHost: (host: HostView) => void;
  onOpenSftp: (host: HostView) => void;
}

const address = (h: HostView) => `${h.username ? `${h.username}@` : ""}${h.hostname}${h.port === 22 ? "" : `:${h.port}`}`;

/** Termius-style host library: every saved host as a card or a row, grouped, searchable. */
export function HostsView({ onOpenHost, onOpenSftp }: HostsViewProps) {
  const { hosts, groups, loaded } = useHostsStore();
  const tabs = useTabsStore((s) => s.tabs);
  const { openNewHost, openHostEditor, setImportConfigOpen } = useDialogsStore();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupView | null>(null);
  const drag = useHostDrag((hostId, groupId) => void useHostsStore.getState().moveHost(hostId, groupId));
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ViewMode>(readViewMode);

  const changeMode = (next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Blocked storage: the choice lasts for this session.
    }
  };

  const sections = useMemo(() => {
    const visible = hosts.filter((h) => hostMatches(h, query)).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    const byGroup: { group: GroupView | null; hosts: HostView[] }[] = groups
      .map((group) => ({ group, hosts: visible.filter((h) => h.groupId === group.id) }))
      .filter((s) => s.hosts.length > 0);
    const known = new Set(groups.map((g) => g.id));
    const ungrouped = visible.filter((h) => !h.groupId || !known.has(h.groupId));
    if (ungrouped.length > 0) byGroup.push({ group: null, hosts: ungrouped });
    return byGroup;
  }, [hosts, groups, query]);

  return (
    <section aria-label="Host library" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Server size={16} className="text-fg-muted" />
        <h1 className="text-[15px] font-semibold">Hosts</h1>
        <span className="text-xs text-fg-muted">{hosts.length} saved</span>
        <Input type="search" aria-label="Search hosts" placeholder="Search name, address or tag…" value={query} onChange={(e) => setQuery(e.target.value)} className="ml-auto h-7 w-64" />
        <div role="radiogroup" aria-label="View" className="flex rounded-md border border-border-strong p-0.5">
          {(["grid", "list"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              aria-label={m === "grid" ? "Grid view" : "List view"}
              onClick={() => changeMode(m)}
              className={cn("grid h-6 w-7 place-items-center rounded", mode === m ? "bg-active text-fg" : "text-fg-muted hover:text-fg")}
            >
              {m === "grid" ? <LayoutGrid size={13} /> : <List size={13} />}
            </button>
          ))}
        </div>
        <Button size="icon" aria-label="Import from SSH config" title="Import ~/.ssh/config" onClick={() => setImportConfigOpen(true)}>
          <FileInput size={15} />
        </Button>
        <Button size="icon" aria-label="New group" title="New group" onClick={() => setCreatingGroup(true)}>
          <FolderPlus size={15} />
        </Button>
        <Button variant="primary" size="sm" onClick={openNewHost}>
          <Plus size={14} /> New host
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loaded && hosts.length === 0 && (
          <div className="mx-auto mt-16 max-w-sm text-center text-fg-muted">
            <p className="text-fg">No hosts yet</p>
            <p className="mt-1 text-[13px]">Add a server, or import the ones in your ~/.ssh/config from the sidebar.</p>
          </div>
        )}
        {hosts.length > 0 && sections.length === 0 && <p className="text-[13px] text-fg-muted">No host matches “{query}”.</p>}
        {sections.map(({ group, hosts: items }) => (
          <section
            key={group?.id ?? "ungrouped"}
            aria-label={group?.name ?? "Ungrouped"}
            {...{ [DROP_ATTR]: group?.id ?? "" }}
            className={cn("mb-5 rounded-lg", drag.dropTarget === (group?.id ?? "") && "bg-accent/5 ring-1 ring-accent")}
          >
            <h2 className="group/heading mb-2 flex items-center gap-1 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
              {group?.name ?? "Ungrouped"} <span className="font-normal">· {items.length}</span>
              {group && (
                <button
                  type="button"
                  aria-label={`Edit group ${group.name}`}
                  title="Edit group"
                  onClick={() => setEditingGroup(group)}
                  className="rounded p-0.5 opacity-0 group-hover/heading:opacity-100 hover:bg-hover focus-visible:opacity-100"
                >
                  <Pencil size={11} />
                </button>
              )}
            </h2>
            <ul className={mode === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2" : "flex flex-col gap-1"}>
              {items.map((host) => {
                const actions = (
                  <div className="flex shrink-0 gap-0.5">
                    <button type="button" aria-label={`Connect to ${host.label}`} title="Connect" onClick={() => onOpenHost(host)} className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg">
                      <Terminal size={13} />
                    </button>
                    <button type="button" aria-label={`Open SFTP to ${host.label}`} title="SFTP" onClick={() => onOpenSftp(host)} className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg">
                      <FolderTree size={13} />
                    </button>
                    <button type="button" aria-label={`Edit ${host.label}`} title="Edit" onClick={() => openHostEditor(host)} className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-hover hover:text-fg">
                      <Pencil size={12} />
                    </button>
                  </div>
                );
                const dot = <StatusDot state={hostDot(host.id, tabs)} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-bg-elev" />;
                const common = {
                  "aria-label": host.label,
                  onDoubleClick: () => onOpenHost(host),
                  onPointerDown: (e: PointerEvent<HTMLLIElement>) => drag.onPointerDown(e, host),
                  title: `${osName(host.os)} · double-click to connect`,
                };
                const frame = "group cursor-default rounded-lg border border-border bg-bg-elev hover:border-border-strong";
                if (mode === "grid") {
                  // Stacked card: the label gets the full width and may wrap to two lines.
                  return (
                    <li key={host.id} {...common} className={cn(frame, "flex min-w-0 flex-col gap-2 p-3", drag.draggingId === host.id && "opacity-50")}>
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-bg-sunk">
                          <OsIcon os={host.os} size={22} />
                          {dot}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-start gap-1.5 text-[13px] leading-5 font-medium">
                            <span className="line-clamp-2 min-w-0 break-words">{host.label}</span>
                            <EnvironmentBadge environment={host.environment} className="mt-0.5" />
                          </p>
                          <p className="truncate font-mono text-[11px] text-fg-muted" title={address(host)}>
                            {address(host)}
                          </p>
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center gap-1">
                        <p className="flex min-w-0 flex-1 flex-wrap gap-1" title={host.tags.join(", ")}>
                          {host.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="max-w-full truncate rounded border border-border-strong px-1 text-[10px] text-fg-muted">
                              {tag}
                            </span>
                          ))}
                          {host.tags.length > 3 && <span className="text-[10px] text-fg-muted">+{host.tags.length - 3}</span>}
                        </p>
                        {actions}
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={host.id} {...common} className={cn(frame, "flex items-center gap-3 px-3 py-1.5", drag.draggingId === host.id && "opacity-50")}>
                    <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bg-sunk">
                      <OsIcon os={host.os} size={16} />
                      {dot}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[13px] font-medium">
                        <span className="truncate">{host.label}</span>
                        <EnvironmentBadge environment={host.environment} />
                      </p>
                      <p className="truncate font-mono text-[11px] text-fg-muted">{address(host)}</p>
                    </div>
                    {host.tags.length > 0 && <span className="hidden truncate text-[11px] text-fg-muted sm:block">{host.tags.join(", ")}</span>}
                    {actions}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {!query.trim() &&
          groups
          .filter((g) => !sections.some((s) => s.group?.id === g.id))
          .map((g) => (
            <section key={g.id} aria-label={g.name} {...{ [DROP_ATTR]: g.id }} className={cn("mb-3 rounded-lg border border-dashed border-border p-3 text-xs text-fg-muted", drag.dropTarget === g.id && "border-accent bg-accent/5")}>
              <span className="flex items-center gap-1">
                {g.name} · empty — drag hosts here
                <button type="button" aria-label={`Edit group ${g.name}`} title="Edit group" onClick={() => setEditingGroup(g)} className="ml-auto rounded p-0.5 hover:bg-hover">
                  <Pencil size={11} />
                </button>
              </span>
            </section>
          ))}
      </div>
      {drag.ghost}
      <GroupFormDialog open={creatingGroup} onOpenChange={setCreatingGroup} />
      <GroupFormDialog open={editingGroup !== null} group={editingGroup ?? undefined} onOpenChange={(open) => !open && setEditingGroup(null)} />
    </section>
  );
}

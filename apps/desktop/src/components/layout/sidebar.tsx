import { ChevronDown, ChevronRight, FileInput, FolderPlus, KeyRound, Lock, Pencil, Plus, Server, Settings, SquareTerminal } from "lucide-react";
import { useMemo, useState } from "react";

import type { GroupView, HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GroupFormDialog } from "@/features/hosts/group-form-dialog";
import { buildHostTree, countHosts, type GroupNode } from "@/features/hosts/host-tree";
import { cn } from "@/lib/utils";
import { useDialogsStore } from "@/stores/dialogs-store";
import { useHostsStore } from "@/stores/hosts-store";
import { useLayoutStore } from "@/stores/layout-store";

interface SidebarProps {
  onOpenHost: (host: HostView) => void;
}

export function Sidebar({ onOpenHost }: SidebarProps) {
  const section = useLayoutStore((s) => s.section);
  const setSection = useLayoutStore((s) => s.setSection);
  const hostFilter = useLayoutStore((s) => s.hostFilter);
  const setHostFilter = useLayoutStore((s) => s.setHostFilter);
  const { hosts, groups, loaded, error, retryVault } = useHostsStore();
  const { openNewHost, openHostEditor, setImportConfigOpen } = useDialogsStore();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupView | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const openHost = (host: HostView) => {
    setSection("hosts");
    onOpenHost(host);
  };

  const tree = useMemo(() => buildHostTree(hosts, groups, hostFilter), [hosts, groups, hostFilter]);
  const filtering = hostFilter.trim().length > 0;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (host: HostView, depth: number) => (
    <li key={host.id}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Connect to ${host.label}`}
        title={`${host.username ? `${host.username}@` : ""}${host.hostname}:${host.port} — double-click to connect`}
        onDoubleClick={() => openHost(host)}
        onKeyDown={(e) => e.key === "Enter" && openHost(host)}
        className="group flex h-7 cursor-default items-center gap-2 rounded-md pr-1 text-sm hover:bg-bg-elev focus-visible:outline-2 focus-visible:outline-accent"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <Server size={13} className="shrink-0 text-fg-muted" />
        <span className="truncate">{host.label}</span>
        <button
          type="button"
          aria-label={`Edit ${host.label}`}
          onClick={() => openHostEditor(host)}
          className="ml-auto hidden rounded p-1 text-fg-muted group-hover:block hover:bg-bg-sunk focus-visible:block"
        >
          <Pencil size={12} />
        </button>
      </div>
    </li>
  );

  const groupNode = (node: GroupNode, depth: number) => {
    const open = filtering || !collapsed.has(node.group.id);
    return (
      <li key={node.group.id}>
        <div className="group/header flex items-center">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggle(node.group.id)}
            className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md pr-2 text-left text-xs font-semibold tracking-wide text-fg-muted uppercase hover:bg-hover"
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="truncate">{node.group.name}</span>
            <span className="ml-auto font-normal">{countHosts(node)}</span>
          </button>
          <button
            type="button"
            aria-label={`Edit group ${node.group.name}`}
            onClick={() => setEditingGroup(node.group)}
            className="hidden rounded p-1 text-fg-muted group-hover/header:block hover:bg-hover focus-visible:block"
          >
            <Pencil size={11} />
          </button>
        </div>
        {open && (
          <ul>
            {node.children.map((c) => groupNode(c, depth + 1))}
            {node.hosts.map((h) => row(h, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const empty = loaded && hosts.length === 0;
  const noMatch = loaded && hosts.length > 0 && filtering && tree.groups.length === 0 && tree.ungrouped.length === 0;

  return (
    <aside aria-label="Hosts sidebar" className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-sunk">
      <div className="flex items-center gap-1 p-3">
        <Input
          type="search"
          aria-label="Filter hosts"
          placeholder="Filter hosts…"
          value={hostFilter}
          onChange={(e) => setHostFilter(e.target.value)}
        />
        <Button size="icon" aria-label="Import from SSH config" title="Import ~/.ssh/config" onClick={() => setImportConfigOpen(true)}>
          <FileInput size={15} />
        </Button>
        <Button size="icon" aria-label="New group" title="New group" onClick={() => setCreatingGroup(true)}>
          <FolderPlus size={15} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {!loaded && (
          <p role="status" className="flex items-center gap-2 px-1 text-sm text-fg-muted">
            <Lock size={13} className="animate-pulse" /> Unlocking vault…
          </p>
        )}
        {error && (
          <div role="alert" className="flex flex-col items-start gap-2 px-1 text-sm text-danger">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => void retryVault()}>
              Try again
            </Button>
          </div>
        )}
        {empty && <p className="px-1 text-sm text-fg-muted">No hosts yet.</p>}
        {noMatch && <p className="px-1 text-sm text-fg-muted">No host matches “{hostFilter}”.</p>}
        <ul aria-label="Hosts">
          {tree.groups.map((g) => groupNode(g, 0))}
          {tree.ungrouped.map((h) => row(h, 0))}
        </ul>
      </div>

      <nav aria-label="Sections" className="flex flex-col gap-0.5 border-t border-border p-2">
        <Button
          className={cn("justify-start", section === "hosts" && "bg-active text-fg")}
          aria-current={section === "hosts" ? "page" : undefined}
          onClick={() => setSection("hosts")}
        >
          <Server size={15} /> Hosts
        </Button>
        <Button
          className={cn("justify-start", section === "keychain" && "bg-active text-fg")}
          aria-current={section === "keychain" ? "page" : undefined}
          onClick={() => setSection("keychain")}
        >
          <KeyRound size={15} /> Keychain
        </Button>
        <Button className="justify-start" disabled title="Coming in M2">
          <SquareTerminal size={15} /> Snippets
        </Button>
        <Button
          className={cn("justify-start", section === "settings" && "bg-active text-fg")}
          aria-current={section === "settings" ? "page" : undefined}
          onClick={() => setSection("settings")}
        >
          <Settings size={15} /> Settings
        </Button>
        <Button className="justify-start" variant="outline" onClick={openNewHost}>
          <Plus size={15} /> New host
        </Button>
      </nav>

      <GroupFormDialog open={creatingGroup} onOpenChange={setCreatingGroup} />
      <GroupFormDialog
        open={editingGroup !== null}
        group={editingGroup ?? undefined}
        onOpenChange={(open) => !open && setEditingGroup(null)}
      />
    </aside>
  );
}

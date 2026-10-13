import type { GroupView, HostView } from "@/bindings";

export interface GroupNode {
  group: GroupView;
  hosts: HostView[];
  children: GroupNode[];
}

export interface HostTree {
  groups: GroupNode[];
  ungrouped: HostView[];
}

/** Case-insensitive match on label, hostname, username or any tag; every word must match. */
export function hostMatches(host: HostView, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [host.label, host.hostname, host.username ?? "", ...host.tags].join(" ").toLowerCase();
  return words.every((w) => haystack.includes(w));
}

const byLabel = (a: HostView, b: HostView) => a.label.localeCompare(b.label);
const byName = (a: GroupNode, b: GroupNode) => a.group.name.localeCompare(b.group.name);

/**
 * Nests hosts under their groups (one level of subgroups). While filtering, groups with no
 * matching host anywhere below them are dropped.
 */
export function buildHostTree(hosts: HostView[], groups: GroupView[], filter = ""): HostTree {
  const visible = hosts.filter((h) => hostMatches(h, filter)).sort(byLabel);
  const known = new Set(groups.map((g) => g.id));
  const node = (group: GroupView): GroupNode => ({
    group,
    hosts: visible.filter((h) => h.groupId === group.id),
    children: [],
  });

  const nodes = new Map(groups.map((g) => [g.id, node(g)]));
  const roots: GroupNode[] = [];
  for (const current of nodes.values()) {
    const parent = current.group.parentId ? nodes.get(current.group.parentId) : undefined;
    if (parent) parent.children.push(current);
    else roots.push(current);
  }

  const prune = (n: GroupNode): GroupNode | null => {
    const children = n.children.map(prune).filter((c): c is GroupNode => c !== null).sort(byName);
    if (filter.trim() && n.hosts.length === 0 && children.length === 0) return null;
    return { ...n, children };
  };

  return {
    groups: roots.map(prune).filter((n): n is GroupNode => n !== null).sort(byName),
    ungrouped: visible.filter((h) => !h.groupId || !known.has(h.groupId)),
  };
}

export function countHosts(node: GroupNode): number {
  return node.hosts.length + node.children.reduce((sum, c) => sum + countHosts(c), 0);
}

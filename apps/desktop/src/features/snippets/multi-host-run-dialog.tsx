import { Play, Server } from "lucide-react";
import { useState } from "react";

import type { HostView, SnippetView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { buildHostTree, type GroupNode } from "@/features/hosts/host-tree";
import { useHostsStore } from "@/stores/hosts-store";

import { snippetKeystrokes } from "./keystrokes";
import { SnippetFields } from "./snippet-fields";
import { useSnippetCommand } from "./use-snippet-command";

interface MultiHostRunDialogProps {
  snippet: SnippetView;
  /** Opens one tab per host and runs `keystrokes` in each once it connects. */
  onRun: (hosts: HostView[], keystrokes: string) => void;
  onClose: () => void;
}

const hostsIn = (node: GroupNode): HostView[] => [...node.hosts, ...node.children.flatMap(hostsIn)];

/** Pick hosts, fill variables, review who receives the command, then run it everywhere. */
export function MultiHostRunDialog({ snippet, onRun, onClose }: MultiHostRunDialogProps) {
  const hosts = useHostsStore((s) => s.hosts);
  const groups = useHostsStore((s) => s.groups);
  const tree = buildHostTree(hosts, groups, "");
  const form = useSnippetCommand(snippet);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const chosen = hosts.filter((h) => selected.has(h.id));

  const toggle = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const hostBox = (host: HostView, depth: number) => (
    <label key={host.id} className="flex items-center gap-2 py-0.5 text-[13px]" style={{ paddingLeft: depth * 14 }}>
      <input type="checkbox" className="accent-accent" checked={selected.has(host.id)} onChange={(e) => toggle([host.id], e.target.checked)} />
      <Server size={12} className="text-fg-muted" />
      {host.label}
    </label>
  );
  const groupBox = (node: GroupNode, depth: number) => {
    const ids = hostsIn(node).map((h) => h.id);
    const all = ids.length > 0 && ids.every((id) => selected.has(id));
    return (
      <div key={node.group.id}>
        <label className="flex items-center gap-2 py-0.5 text-xs font-semibold tracking-wide text-fg-muted uppercase" style={{ paddingLeft: depth * 14 }}>
          <input type="checkbox" aria-label={`All hosts in ${node.group.name}`} className="accent-accent" checked={all} onChange={(e) => toggle(ids, e.target.checked)} />
          {node.group.name}
        </label>
        {node.children.map((c) => groupBox(c, depth + 1))}
        {node.hosts.map((h) => hostBox(h, depth + 1))}
      </div>
    );
  };

  return (
    <Dialog open width="lg" title={`Run ${snippet.name} on several hosts`} icon={<Play size={15} />} onOpenChange={(open) => !open && onClose()}>
      {reviewing ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px]">
            This opens {chosen.length} tab{chosen.length === 1 ? "" : "s"} and runs the command in each as soon as it connects. Tabs that need a password or a host key
            confirmation wait for you.
          </p>
          <ul aria-label="Hosts that will run it" className="flex flex-col gap-0.5 font-mono text-xs">
            {chosen.map((h) => (
              <li key={h.id}>
                {h.label} <span className="text-fg-muted">({h.hostname})</span>
              </li>
            ))}
          </ul>
          <pre className="rounded border border-border bg-bg-sunk p-2 font-mono text-[12px] whitespace-pre-wrap">{form.command}</pre>
          <DialogFooter className="justify-end">
            <Button variant="outline" onClick={() => setReviewing(false)}>
              Back
            </Button>
            <Button
              variant={form.reason ? "danger" : "primary"}
              autoFocus
              onClick={() => {
                onRun(chosen, snippetKeystrokes(form.command, true));
                onClose();
              }}
            >
              <Play size={13} /> Run on {chosen.length} host{chosen.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <SnippetFields form={form} />
          <fieldset aria-label="Hosts" className="max-h-56 overflow-y-auto rounded-md border border-border p-2">
            {tree.groups.map((g) => groupBox(g, 0))}
            {tree.ungrouped.map((h) => hostBox(h, 0))}
            {hosts.length === 0 && <p className="text-xs text-fg-muted">No saved hosts.</p>}
          </fieldset>
          <DialogFooter className="justify-end">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={chosen.length === 0 || form.blocked} onClick={() => setReviewing(true)}>
              Review {chosen.length > 0 ? `${chosen.length} host${chosen.length === 1 ? "" : "s"}` : ""}
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}

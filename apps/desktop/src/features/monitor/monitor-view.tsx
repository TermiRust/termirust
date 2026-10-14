import { Activity, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EnvironmentBadge } from "@/components/ui/environment-badge";
import { Input } from "@/components/ui/input";
import { OsIcon } from "@/components/ui/os-icon";
import { hostMatches } from "@/features/hosts/host-tree";
import { useHostsStore } from "@/stores/hosts-store";

import { MonitorCard } from "./monitor-card";
import { loadMonitoredHosts, saveMonitoredHosts } from "./selection";

/** Pick hosts and watch their CPU, memory and disk side by side. */
export function MonitorView() {
  const hosts = useHostsStore((s) => s.hosts);
  const loaded = useHostsStore((s) => s.loaded);
  const [selected, setSelected] = useState<string[]>(loadMonitoredHosts);
  const [picking, setPicking] = useState(() => loadMonitoredHosts().length === 0);
  const [query, setQuery] = useState("");

  // Hosts deleted since the selection was saved simply drop out.
  const watched = useMemo(() => selected.flatMap((id) => hosts.filter((h) => h.id === id)), [selected, hosts]);
  const choices = useMemo(
    () => hosts.filter((h) => hostMatches(h, query)).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [hosts, query],
  );

  const update = (next: string[]) => {
    setSelected(next);
    saveMonitoredHosts(next);
  };
  const toggle = (id: string) => update(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <section aria-label="Monitor" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Activity size={16} className="text-fg-muted" />
        <h1 className="text-[15px] font-semibold">Monitor</h1>
        <span className="text-xs text-fg-muted">CPU, memory and disk, refreshed every 10 seconds</span>
        <Button variant={picking ? "primary" : "outline"} size="sm" className="ml-auto" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          <Plus size={13} /> Choose hosts
        </Button>
      </header>

      {picking && (
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="relative mb-2 w-[min(320px,100%)]">
            <Search size={13} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" />
            <Input type="search" aria-label="Find a host to monitor" placeholder="Find a host…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 pl-8" />
          </div>
          {loaded && hosts.length === 0 && <p className="text-[12px] text-fg-muted">Add a host first; Monitor uses the same login.</p>}
          <div role="group" aria-label="Hosts to monitor" className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {choices.map((host) => {
              const on = selected.includes(host.id);
              return (
                <button
                  key={host.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(host.id)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${on ? "border-accent bg-accent-soft text-fg" : "border-border bg-bg-elev text-fg-2 hover:bg-hover"}`}
                >
                  <OsIcon os={host.os} size={13} />
                  {host.label}
                  <EnvironmentBadge environment={host.environment} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {watched.length === 0 ? (
          <p className="mt-16 text-center text-[13px] text-fg-muted">Choose one or more hosts to see how they are doing.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {watched.map((host) => (
              <MonitorCard key={host.id} host={host} onRemove={() => toggle(host.id)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

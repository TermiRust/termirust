import { FolderTree, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { HostView } from "@/bindings";
import { EnvironmentBadge } from "@/components/ui/environment-badge";
import { Input } from "@/components/ui/input";
import { OsIcon } from "@/components/ui/os-icon";
import { hostMatches } from "@/features/hosts/host-tree";
import { useHostsStore } from "@/stores/hosts-store";

interface SftpLauncherProps {
  onOpen: (host: HostView) => void;
}

/** SFTP from the menu: pick a host and connect, without opening a terminal first. */
export function SftpLauncher({ onOpen }: SftpLauncherProps) {
  const hosts = useHostsStore((s) => s.hosts);
  const loaded = useHostsStore((s) => s.loaded);
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => hosts.filter((h) => hostMatches(h, query)).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [hosts, query],
  );

  return (
    <section aria-label="SFTP" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <FolderTree size={16} className="text-fg-muted" />
        <h1 className="text-[15px] font-semibold">SFTP</h1>
        <span className="text-xs text-fg-muted">Choose a host to browse its files</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-[min(560px,100%)] flex-col gap-3">
          <div className="relative">
            <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
            <Input
              type="search"
              autoFocus
              aria-label="Find a host for SFTP"
              placeholder="Find a host…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown[0]) onOpen(shown[0]);
              }}
              className="h-9 pl-9 text-[14px]"
            />
          </div>
          {loaded && hosts.length === 0 && <p className="text-center text-[13px] text-fg-muted">Add a host first; SFTP uses the same login.</p>}
          {hosts.length > 0 && shown.length === 0 && <p className="text-center text-[13px] text-fg-muted">No host matches “{query}”.</p>}
          <ul aria-label="Hosts for SFTP" className="flex flex-col gap-1">
            {shown.map((host) => (
              <li key={host.id}>
                <button
                  type="button"
                  aria-label={`Browse files on ${host.label}`}
                  onClick={() => onOpen(host)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-bg-elev px-3 py-2 text-left hover:border-accent hover:bg-hover"
                >
                  <OsIcon os={host.os} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">
                      <span className="truncate">{host.label}</span>
                      <EnvironmentBadge environment={host.environment} />
                    </span>
                    <span className="block truncate font-mono text-[11px] text-fg-muted">
                      {host.username ? `${host.username}@` : ""}
                      {host.hostname}
                    </span>
                  </span>
                  <span className="text-xs text-fg-muted">Connect →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

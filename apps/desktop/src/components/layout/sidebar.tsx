import { KeyRound, Plus, Server, SquareTerminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLayoutStore } from "@/stores/layout-store";

export function Sidebar() {
  const hostFilter = useLayoutStore((s) => s.hostFilter);
  const setHostFilter = useLayoutStore((s) => s.setHostFilter);

  return (
    <aside
      aria-label="Hosts sidebar"
      className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-sunk"
    >
      <div className="p-3">
        <Input
          type="search"
          aria-label="Filter hosts"
          placeholder="Filter hosts…"
          value={hostFilter}
          onChange={(e) => setHostFilter(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 text-sm text-fg-muted">
        <p>No hosts yet.</p>
      </div>

      <nav aria-label="Sections" className="flex flex-col gap-0.5 border-t border-border p-2">
        <Button className="justify-start" aria-current="page">
          <Server size={15} /> Hosts
        </Button>
        <Button className="justify-start" disabled title="Coming soon">
          <KeyRound size={15} /> Keychain
        </Button>
        <Button className="justify-start" disabled title="Coming in M2">
          <SquareTerminal size={15} /> Snippets
        </Button>
        <Button className="justify-start" variant="outline" disabled title="Coming soon">
          <Plus size={15} /> New host
        </Button>
      </nav>
    </aside>
  );
}

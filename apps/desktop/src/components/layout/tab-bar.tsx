import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

export function TabBar() {
  return (
    <div
      role="tablist"
      aria-label="Sessions"
      className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2"
    >
      <Button size="icon" aria-label="New tab" disabled title="Coming soon">
        <Plus size={15} />
      </Button>
    </div>
  );
}

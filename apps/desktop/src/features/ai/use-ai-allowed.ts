import type { HostView } from "@/bindings";
import { useAiStore } from "@/stores/ai-store";
import { useHostsStore } from "@/stores/hosts-store";

import { aiAllowedFor } from "./ai-access";

/** Uses the host's latest saved switches, not the copy the tab opened with. */
export function useAiAllowed(host: HostView | null): boolean {
  const settings = useAiStore((s) => s.settings);
  const hosts = useHostsStore((s) => s.hosts);
  const groups = useHostsStore((s) => s.groups);
  const latest = host ? (hosts.find((h) => h.id === host.id) ?? host) : null;
  return aiAllowedFor(settings, latest, groups);
}

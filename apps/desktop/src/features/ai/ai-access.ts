import type { AiSettingsView, GroupView, HostView } from "@/bindings";

/** AI shows in a tab only when it is on and neither the host nor its group turned it off. */
export function aiAllowedFor(settings: AiSettingsView | null, host: HostView | null, groups: GroupView[]): boolean {
  if (!settings?.enabled) return false;
  if (!host) return true;
  if (host.aiDisabled) return false;
  return !groups.some((g) => g.id === host.groupId && g.aiDisabled);
}

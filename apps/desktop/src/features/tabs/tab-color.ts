export type TabColor = "red" | "amber" | "teal" | "blue" | "violet";

const ROTATION: TabColor[] = ["teal", "blue", "violet"];

/**
 * Colour hint for tabs of hosts in a group (ADR-014): production-like names are red,
 * staging-like amber, others get a stable colour from the group id.
 */
export function groupTabColor(group: { id: string; name: string } | null | undefined): TabColor | null {
  if (!group) return null;
  const name = group.name.toLowerCase();
  if (/\bpreprod/.test(name) || /\bstag/.test(name) || /\buat\b/.test(name)) return "amber";
  if (/\bprod/.test(name) || /\blive\b/.test(name)) return "red";
  let hash = 0;
  for (const ch of group.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ROTATION[hash % ROTATION.length] ?? "teal";
}

const KNOWN: TabColor[] = ["red", "amber", "teal", "blue", "violet"];
const asTabColor = (value: string | null | undefined): TabColor | null => (KNOWN as string[]).includes(value ?? "") ? (value as TabColor) : null;

/** Host override first, then the group's chosen colour, then one derived from the group name. */
export function resolveTabColor(
  host: { color: string | null },
  group: { id: string; name: string; color: string | null } | null | undefined,
): TabColor | null {
  return asTabColor(host.color) ?? asTabColor(group?.color) ?? groupTabColor(group);
}

export const TAB_COLOR_CHOICES = KNOWN;

export const tabColorVar: Record<TabColor, string> = {
  red: "var(--tab-red)",
  amber: "var(--tab-amber)",
  teal: "var(--tab-teal)",
  blue: "var(--tab-blue)",
  violet: "var(--tab-violet)",
};

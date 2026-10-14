/** Tabs shrink down to this width; beyond that, extra tabs move into the overflow list. */
export const MIN_TAB_WIDTH = 96;

/** How many tabs fit, or every tab when the width is unknown (not measured yet, or tests). */
export function tabCapacity(width: number, minWidth = MIN_TAB_WIDTH): number {
  if (!(width > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor(width / minWidth));
}

/**
 * Splits tabs into those drawn in the bar and those behind the overflow button. Order is
 * kept, and the active tab is always drawn: it replaces the last visible one if needed.
 */
export function splitVisibleTabs<T extends { id: string }>(tabs: T[], activeId: string | null, capacity: number): { shown: T[]; hidden: T[] } {
  if (tabs.length <= capacity) return { shown: tabs, hidden: [] };
  const count = Math.max(1, capacity);
  let shownIds = new Set(tabs.slice(0, count).map((t) => t.id));
  if (activeId && !shownIds.has(activeId) && tabs.some((t) => t.id === activeId)) {
    const kept = tabs.slice(0, count - 1).map((t) => t.id);
    shownIds = new Set([...kept, activeId]);
  }
  return { shown: tabs.filter((t) => shownIds.has(t.id)), hidden: tabs.filter((t) => !shownIds.has(t.id)) };
}

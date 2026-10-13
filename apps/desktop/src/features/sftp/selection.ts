export interface ClickModifiers {
  /** ⌘ on macOS, Ctrl elsewhere: toggle one item. */
  toggle: boolean;
  /** Shift: select the range from the anchor. */
  range: boolean;
}

/** Finder-style selection over the visible order of `paths`. */
export function nextSelection(
  paths: string[],
  selected: string[],
  anchor: string | null,
  clicked: string,
  { toggle, range }: ClickModifiers,
): string[] {
  if (range && anchor !== null) {
    const from = paths.indexOf(anchor);
    const to = paths.indexOf(clicked);
    if (from >= 0 && to >= 0) return paths.slice(Math.min(from, to), Math.max(from, to) + 1);
  }
  if (toggle) return selected.includes(clicked) ? selected.filter((p) => p !== clicked) : [...selected, clicked];
  return [clicked];
}

/** Moves a single selection up or down, starting at the first item when nothing is selected. */
export function stepSelection(paths: string[], selected: string[], delta: 1 | -1): string[] {
  if (paths.length === 0) return [];
  const last = selected.at(-1);
  const index = last === undefined ? -1 : paths.indexOf(last);
  if (index < 0) return [paths[delta === 1 ? 0 : paths.length - 1] as string];
  const next = Math.max(0, Math.min(paths.length - 1, index + delta));
  return [paths[next] as string];
}

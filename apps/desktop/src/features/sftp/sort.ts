import type { FileEntry } from "@/bindings";

export type SortKey = "name" | "size" | "modified";
export interface SortOrder {
  key: SortKey;
  ascending: boolean;
}

export const DEFAULT_SORT: SortOrder = { key: "name", ascending: true };

const byName = (a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Folders always stay above files; ties fall back to name order. */
export function sortEntries(entries: FileEntry[], { key, ascending }: SortOrder): FileEntry[] {
  const sign = ascending ? 1 : -1;
  return [...entries].sort((a, b) => {
    const folders = Number(b.kind === "directory") - Number(a.kind === "directory");
    if (folders !== 0) return folders;
    let order = 0;
    if (key === "size") order = a.size - b.size;
    else if (key === "modified") order = (a.modified ?? 0) - (b.modified ?? 0);
    return sign * (order || byName(a, b));
  });
}

/** Clicking the active column flips its direction; another column starts ascending. */
export function toggleSort(current: SortOrder, key: SortKey): SortOrder {
  return current.key === key ? { key, ascending: !current.ascending } : { key, ascending: true };
}

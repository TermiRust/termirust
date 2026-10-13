const STORAGE_KEY = "termirust.recentHosts";
const LIMIT = 8;

/** Most recently opened host ids, newest first. A per-device convenience, safe to lose. */
export function loadRecentHostIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentHost(id: string): string[] {
  const next = [id, ...loadRecentHostIds().filter((h) => h !== id)].slice(0, LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable; the list just won't persist.
  }
  return next;
}

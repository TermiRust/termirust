const STORAGE_KEY = "termirust.monitor.hosts";

/** The hosts last shown on the Monitor screen, in the order they were added. */
export function loadMonitoredHosts(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveMonitoredHosts(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable; the selection then lasts for this session only.
  }
}

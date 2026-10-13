const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Binary multiples with one decimal from KB up, e.g. "1.5 MB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Unix seconds as a short local date and time. */
export function formatModified(seconds: number | null, locale?: string): string {
  if (seconds === null) return "";
  return new Date(seconds * 1000).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Unix permission bits as "rwxr-xr-x". */
export function formatPermissions(mode: number | null): string {
  if (mode === null) return "";
  const flags = "rwxrwxrwx";
  return [...flags].map((flag, i) => (mode & (1 << (8 - i)) ? flag : "-")).join("");
}

/** Remaining time as "45s", "3m 05s" or "1h 02m". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

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

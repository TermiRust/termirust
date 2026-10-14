import type { HostStatsDto } from "@/bindings";

/** "512 MB", "7.6 GB", "1.2 TB" from KiB. */
export function formatKb(kb: number): string {
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = kb;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** "3d 4h", "5h 12m", "8m". */
export function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86_400);
  const hours = Math.floor((secs % 86_400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export type Level = "ok" | "warn" | "crit";

/** Thresholds for the bar colour: 75% amber, 90% red. */
export function levelOf(percent: number): Level {
  if (percent >= 90) return "crit";
  if (percent >= 75) return "warn";
  return "ok";
}

export interface Usage {
  used: number;
  total: number;
  percent: number;
}

function usage(used: number | null, total: number | null): Usage | null {
  if (used === null || total === null || total <= 0) return null;
  const clamped = Math.min(Math.max(used, 0), total);
  return { used: clamped, total, percent: (clamped / total) * 100 };
}

export function memoryUsage(s: HostStatsDto): Usage | null {
  if (s.memTotalKb === null || s.memAvailableKb === null) return null;
  return usage(s.memTotalKb - s.memAvailableKb, s.memTotalKb);
}

export function swapUsage(s: HostStatsDto): Usage | null {
  if (s.swapTotalKb === null || s.swapFreeKb === null) return null;
  return usage(s.swapTotalKb - s.swapFreeKb, s.swapTotalKb);
}

export function diskUsage(s: HostStatsDto): Usage | null {
  return usage(s.diskUsedKb, s.diskTotalKb);
}

/** "0.42 · 0.31 · 0.25" (1, 5 and 15 minutes). */
export function formatLoad(load: HostStatsDto["load"]): string | null {
  if (!load || load.length < 3 || load.some((v) => v === null)) return null;
  return load.map((v) => (v ?? 0).toFixed(2)).join(" · ");
}

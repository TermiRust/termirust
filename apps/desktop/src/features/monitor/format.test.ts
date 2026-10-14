import { describe, expect, it } from "vitest";

import type { HostStatsDto } from "@/bindings";

import { diskUsage, formatKb, formatLoad, formatUptime, levelOf, memoryUsage, swapUsage } from "./format";

const empty: HostStatsDto = {
  osId: null,
  osName: null,
  kernel: null,
  hostname: null,
  uptimeSecs: null,
  load: null,
  cpuCount: null,
  cpuPercent: null,
  memTotalKb: null,
  memAvailableKb: null,
  swapTotalKb: null,
  swapFreeKb: null,
  diskTotalKb: null,
  diskUsedKb: null,
  diskMount: null,
  addresses: [],
  topProcesses: [],
};

describe("monitor format", () => {
  it("formats sizes from KiB", () => {
    expect(formatKb(512)).toBe("512 KB");
    expect(formatKb(524_288)).toBe("512 MB");
    expect(formatKb(8_000_000)).toBe("7.6 GB");
    expect(formatKb(51_475_068)).toBe("49.1 GB");
    expect(formatKb(2 * 1024 ** 3)).toBe("2.0 TB");
  });

  it("formats uptime by its largest units", () => {
    expect(formatUptime(356_400)).toBe("4d 3h");
    expect(formatUptime(18_720)).toBe("5h 12m");
    expect(formatUptime(480)).toBe("8m");
  });

  it("colours usage at 75% and 90%", () => {
    expect([levelOf(10), levelOf(75), levelOf(89.9), levelOf(90)]).toEqual(["ok", "warn", "warn", "crit"]);
  });

  it("works out memory, swap and disk use, or nothing when unknown", () => {
    const s = { ...empty, memTotalKb: 8000, memAvailableKb: 2000, swapTotalKb: 1000, swapFreeKb: 1000, diskTotalKb: 100, diskUsedKb: 43 };
    expect(memoryUsage(s)).toEqual({ used: 6000, total: 8000, percent: 75 });
    expect(swapUsage(s)?.percent).toBe(0);
    expect(diskUsage(s)?.percent).toBe(43);
    expect([memoryUsage(empty), swapUsage(empty), diskUsage(empty)]).toEqual([null, null, null]);
    expect(swapUsage({ ...empty, swapTotalKb: 0, swapFreeKb: 0 })).toBeNull();
  });

  it("formats load averages", () => {
    expect(formatLoad([0.42, 0.3, 1.255])).toBe("0.42 · 0.30 · 1.25");
    expect(formatLoad(null)).toBeNull();
  });
});

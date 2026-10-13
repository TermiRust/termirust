import { describe, expect, it } from "vitest";

import { describeThroughput, megabytesPerSecond } from "./throughput";

describe("megabytesPerSecond", () => {
  it("divides megabytes by seconds", () => {
    expect(megabytesPerSecond(100 * 1024 * 1024, 2000)).toBe(50);
  });

  it("returns 0 for a zero or negative duration", () => {
    expect(megabytesPerSecond(1024, 0)).toBe(0);
    expect(megabytesPerSecond(1024, -5)).toBe(0);
  });
});

describe("describeThroughput", () => {
  it("summarises one benchmark run", () => {
    expect(
      describeThroughput({ transport: "raw", totalBytes: 100 * 1024 * 1024, messages: 1600, elapsedMs: 2500 }),
    ).toBe("RAW: 100 MB in 2.50 s · 40.0 MB/s · 1600 messages");
  });
});

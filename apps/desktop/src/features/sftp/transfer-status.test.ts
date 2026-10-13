import { describe, expect, it } from "vitest";

import { progressOf, statusText } from "./transfer-status";

describe("transfer status", () => {
  it("computes progress and never exceeds one", () => {
    expect(progressOf({ state: "queued" })).toBe(0);
    expect(progressOf({ state: "running", done: 5, total: 10, filesDone: 0, filesTotal: 1, current: "" })).toBe(0.5);
    expect(progressOf({ state: "running", done: 0, total: 0, filesDone: 0, filesTotal: 0, current: "" })).toBe(0);
    expect(progressOf({ state: "running", done: 11, total: 10, filesDone: 0, filesTotal: 1, current: "" })).toBe(1);
    expect(progressOf({ state: "completed", bytes: 3 })).toBe(1);
  });

  it("describes each state", () => {
    expect(statusText({ state: "queued" })).toBe("Waiting…");
    expect(statusText({ state: "running", done: 1024, total: 2048, filesDone: 1, filesTotal: 3, current: "" })).toBe("1.0 KB / 2.0 KB · 1/3 files");
    expect(statusText({ state: "running", done: 1, total: 2, filesDone: 0, filesTotal: 1, current: "" })).toBe("1 B / 2 B");
    expect(statusText({ state: "completed", bytes: 2048 })).toBe("Done · 2.0 KB");
    expect(statusText({ state: "failed", message: "denied" })).toBe("denied");
    expect(statusText({ state: "cancelled" })).toBe("Cancelled");
  });
});

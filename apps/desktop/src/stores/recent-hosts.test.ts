import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadRecentHostIds, rememberRecentHost } from "./recent-hosts";

describe("recent hosts", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty", () => {
    expect(loadRecentHostIds()).toEqual([]);
  });

  it("keeps the newest first without duplicates, capped at eight", () => {
    for (const id of ["a", "b", "c", "a"]) rememberRecentHost(id);
    expect(loadRecentHostIds()).toEqual(["a", "c", "b"]);
    for (let i = 0; i < 10; i++) rememberRecentHost(`h${i}`);
    expect(loadRecentHostIds()).toHaveLength(8);
    expect(loadRecentHostIds()[0]).toBe("h9");
  });

  it("survives corrupted or unavailable storage", () => {
    localStorage.setItem("termirust.recentHosts", "{not json");
    expect(loadRecentHostIds()).toEqual([]);
    localStorage.setItem("termirust.recentHosts", JSON.stringify([1, "ok", null]));
    expect(loadRecentHostIds()).toEqual(["ok"]);

    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(rememberRecentHost("x")).toEqual(["x", "ok"]);
    spy.mockRestore();
  });
});

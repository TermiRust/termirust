import { describe, expect, it } from "vitest";

import { compareVersions, isUpdateRequired, minimumVersionOf, visibleNotes } from "./update-policy";

describe("update policy", () => {
  it("reads the minimum version marker from release notes", () => {
    expect(minimumVersionOf("Fixes.\n<!-- minimum-version: 0.2.1 -->")).toBe("0.2.1");
    expect(minimumVersionOf("<!--minimum-version:v1.0-->")).toBe("1.0");
    expect(minimumVersionOf("No marker")).toBeNull();
    expect(minimumVersionOf(null)).toBeNull();
  });

  it("compares versions numerically", () => {
    expect(compareVersions("0.10.0", "0.9.3")).toBe(1);
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    expect(compareVersions("v1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBe(0);
  });

  it("requires an update only below the minimum", () => {
    const notes = "<!-- minimum-version: 0.2.0 -->";
    expect(isUpdateRequired("0.1.9", notes)).toBe(true);
    expect(isUpdateRequired("0.2.0", notes)).toBe(false);
    expect(isUpdateRequired("0.1.0", "plain notes")).toBe(false);
  });

  it("hides the marker from the notes shown to the user", () => {
    expect(visibleNotes("Security fix.\n<!-- minimum-version: 0.2.0 -->")).toBe("Security fix.");
  });
});

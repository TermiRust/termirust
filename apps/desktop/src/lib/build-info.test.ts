import { describe, expect, it } from "vitest";

import { versionLabel } from "./build-info";

describe("versionLabel", () => {
  it("shows the version with the build commit", () => {
    expect(versionLabel("0.0.1", "43aa2ea")).toBe("v0.0.1 · 43aa2ea");
    expect(versionLabel("0.0.1", "")).toBe("v0.0.1");
    expect(versionLabel(null, "43aa2ea")).toBeNull();
  });

  it("gets a build id from the bundler", () => {
    expect(versionLabel("0.0.1")).toMatch(/^v0\.0\.1 · \S+$/);
  });
});

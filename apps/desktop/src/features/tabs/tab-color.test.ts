import { describe, expect, it } from "vitest";

import { groupTabColor } from "./tab-color";

describe("groupTabColor", () => {
  it("has no colour for ungrouped hosts", () => {
    expect(groupTabColor(null)).toBeNull();
    expect(groupTabColor(undefined)).toBeNull();
  });

  it.each([
    ["Production", "red"],
    ["prod-eu", "red"],
    ["Live services", "red"],
    ["Staging", "amber"],
    ["UAT", "amber"],
    ["preprod", "amber"],
  ])("%s → %s", (name, color) => {
    expect(groupTabColor({ id: "x", name })).toBe(color);
  });

  it("gives other groups a stable colour from their id", () => {
    const homelab = { id: "0192aa-homelab", name: "Homelab" };
    expect(groupTabColor(homelab)).toBe(groupTabColor({ ...homelab }));
    expect(["teal", "blue", "violet"]).toContain(groupTabColor(homelab));
  });

  it("does not treat words merely containing 'prod' later on as production", () => {
    expect(groupTabColor({ id: "a", name: "Reproduction lab" })).not.toBe("red");
  });
});

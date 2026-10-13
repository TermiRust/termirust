import { describe, expect, it } from "vitest";

import { groupTabColor, resolveTabColor } from "./tab-color";

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

describe("resolveTabColor", () => {
  const prod = { id: "g", name: "Production", color: null };
  it("prefers the host's own colour, then the group's, then the name-derived one", () => {
    expect(resolveTabColor({ color: "blue" }, { ...prod, color: "teal" })).toBe("blue");
    expect(resolveTabColor({ color: null }, { ...prod, color: "teal" })).toBe("teal");
    expect(resolveTabColor({ color: null }, prod)).toBe("red");
    expect(resolveTabColor({ color: null }, null)).toBeNull();
  });

  it("ignores colours it does not know", () => {
    expect(resolveTabColor({ color: "pink" }, prod)).toBe("red");
  });
});

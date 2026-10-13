import { describe, expect, it } from "vitest";

import type { GroupView, HostView } from "@/bindings";

import { buildHostTree, countHosts, hostMatches } from "./host-tree";

const host = (id: string, overrides: Partial<HostView> = {}): HostView => ({
  id,
  label: id,
  hostname: `${id}.example.com`,
  port: 22,
  username: null,
  auth: { method: "agent" },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null,
  ...overrides,
});
const group = (id: string, name: string, parentId: string | null = null): GroupView => ({ id, name, parentId });

describe("hostMatches", () => {
  const h = host("api", { label: "Prod API", hostname: "10.0.1.12", username: "deploy", tags: ["eu", "critical"] });

  it.each([
    ["", true],
    ["prod", true],
    ["PROD api", true],
    ["10.0.1", true],
    ["deploy", true],
    ["critical", true],
    ["prod staging", false],
    ["db", false],
  ])("%j → %s", (filter, expected) => {
    expect(hostMatches(h, filter)).toBe(expected);
  });
});

describe("buildHostTree", () => {
  const groups = [group("g-prod", "Production"), group("g-eu", "EU", "g-prod"), group("g-dev", "Dev")];
  const hosts = [
    host("b-api", { groupId: "g-prod" }),
    host("a-web", { groupId: "g-prod" }),
    host("paris", { groupId: "g-eu" }),
    host("laptop"),
    host("stray", { groupId: "g-deleted" }),
  ];

  it("nests hosts under groups and subgroups, sorted by name", () => {
    const tree = buildHostTree(hosts, groups);
    expect(tree.groups.map((g) => g.group.name)).toEqual(["Dev", "Production"]);
    const prod = tree.groups[1]!;
    expect(prod.hosts.map((h) => h.id)).toEqual(["a-web", "b-api"]);
    expect(prod.children.map((c) => c.group.name)).toEqual(["EU"]);
    expect(prod.children[0]!.hosts.map((h) => h.id)).toEqual(["paris"]);
    expect(countHosts(prod)).toBe(3);
  });

  it("keeps empty groups when not filtering", () => {
    expect(buildHostTree(hosts, groups).groups.find((g) => g.group.id === "g-dev")?.hosts).toEqual([]);
  });

  it("lists hosts without a group, or whose group no longer exists, as ungrouped", () => {
    expect(buildHostTree(hosts, groups).ungrouped.map((h) => h.id)).toEqual(["laptop", "stray"]);
  });

  it("drops groups with no matching host while filtering but keeps parents of matches", () => {
    const tree = buildHostTree(hosts, groups, "paris");
    expect(tree.groups.map((g) => g.group.name)).toEqual(["Production"]);
    expect(tree.groups[0]!.hosts).toEqual([]);
    expect(tree.groups[0]!.children[0]!.hosts.map((h) => h.id)).toEqual(["paris"]);
    expect(tree.ungrouped).toEqual([]);
  });

  it("treats a subgroup whose parent is missing as a top-level group", () => {
    const tree = buildHostTree([], [group("orphan", "Orphan", "gone")]);
    expect(tree.groups.map((g) => g.group.name)).toEqual(["Orphan"]);
  });
});

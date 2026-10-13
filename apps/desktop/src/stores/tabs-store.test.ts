import { beforeEach, describe, expect, it } from "vitest";

import type { HostView } from "@/bindings";

import { useTabsStore } from "./tabs-store";

const host = (id: string): HostView => ({
  id,
  label: `host-${id}`,
  hostname: `${id}.example.com`,
  port: 22,
  username: null,
  auth: { method: "agent" },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null,
});
const state = () => useTabsStore.getState();
const titles = () => state().tabs.map((t) => t.title);
const initial = useTabsStore.getState();

describe("tabs store", () => {
  beforeEach(() => useTabsStore.setState(initial, true));

  it("opens a host tab, activates it and starts connecting", () => {
    const id = state().openHostTab(host("a"), "red");
    expect(state().activeTabId).toBe(id);
    expect(state().tabs[0]).toMatchObject({ title: "host-a", status: "connecting", color: "red" });
  });

  it("opens the same host twice as two independent tabs", () => {
    const a = state().openHostTab(host("a"), null);
    const b = state().openHostTab(host("a"), null);
    expect(a).not.toBe(b);
    expect(state().tabs).toHaveLength(2);
  });

  it("opens a local terminal tab", () => {
    state().openLocalTab();
    expect(state().tabs[0]).toMatchObject({ title: "Local", target: { kind: "local" }, status: "connecting", color: null });
  });

  it("opens a lab tab", () => {
    state().openLabTab();
    expect(state().tabs[0]).toMatchObject({ title: "Connection lab", target: { kind: "lab" }, status: "idle" });
  });

  it("closing the active tab activates the right neighbour, or the left one at the end", () => {
    const a = state().openHostTab(host("a"), null);
    const b = state().openHostTab(host("b"), null);
    const c = state().openHostTab(host("c"), null);

    state().activateTab(b);
    state().closeTab(b);
    expect(state().activeTabId).toBe(c);

    state().closeTab(c);
    expect(state().activeTabId).toBe(a);

    state().closeTab(a);
    expect(state().activeTabId).toBeNull();
    expect(state().tabs).toEqual([]);
  });

  it("closing an inactive tab keeps the active one", () => {
    const a = state().openHostTab(host("a"), null);
    const b = state().openHostTab(host("b"), null);
    state().closeTab(a);
    expect(state().activeTabId).toBe(b);
  });

  it("ignores unknown ids", () => {
    state().openHostTab(host("a"), null);
    const before = state();
    state().closeTab("nope");
    state().activateTab("nope");
    state().moveTab("nope", 0);
    expect(state().tabs).toBe(before.tabs);
    expect(state().activeTabId).toBe(before.activeTabId);
  });

  it("switches by position, with the ninth slot meaning the last tab", () => {
    const ids = ["a", "b", "c"].map((h) => state().openHostTab(host(h), null));
    state().activateTabAt(0);
    expect(state().activeTabId).toBe(ids[0]);
    state().activateTabAt(8);
    expect(state().activeTabId).toBe(ids[2]);
    state().activateTabAt(5);
    expect(state().activeTabId).toBe(ids[2]);
  });

  it("updates status and only re-renders on a real change", () => {
    const id = state().openHostTab(host("a"), null);
    state().setTabStatus(id, "connected");
    const tabs = state().tabs;
    state().setTabStatus(id, "connected");
    expect(state().tabs).toBe(tabs);
    expect(state().tabs[0]?.status).toBe("connected");
  });

  it("renames with trimming and refuses an empty title", () => {
    const id = state().openHostTab(host("a"), null);
    state().renameTab(id, "  db shell ");
    expect(titles()).toEqual(["db shell"]);
    state().renameTab(id, "   ");
    expect(titles()).toEqual(["db shell"]);
  });

  it("reorders tabs and clamps the target index", () => {
    const [a, , c] = ["a", "b", "c"].map((h) => state().openHostTab(host(h), null));
    state().moveTab(c!, 0);
    expect(titles()).toEqual(["host-c", "host-a", "host-b"]);
    state().moveTab(a!, 99);
    expect(titles()).toEqual(["host-c", "host-b", "host-a"]);
    state().moveTab(a!, -3);
    expect(titles()).toEqual(["host-a", "host-c", "host-b"]);
  });
});

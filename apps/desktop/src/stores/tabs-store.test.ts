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
  keepaliveSecs: null, aiDisabled: false, os: null,
color: null,
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

  it("opens an SFTP tab for a host", () => {
    state().openSftpTab(host("a"), "teal");
    expect(state().tabs[0]).toMatchObject({ title: "host-a · SFTP", target: { kind: "sftp" }, status: "connecting", color: "teal" });
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

  it("records the terminal size and skips no-op updates", () => {
    const id = state().openHostTab(host("a"), null);
    expect(state().tabs[0]?.size).toBeNull();
    state().setTabSize(id, 120, 32);
    const tabs = state().tabs;
    state().setTabSize(id, 120, 32);
    expect(state().tabs).toBe(tabs);
    expect(state().tabs[0]?.size).toEqual({ cols: 120, rows: 32 });
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

  describe("panes", () => {
    const tab = () => state().tabs[0]!;

    it("starts every tab with one focused pane", () => {
      state().openLocalTab();
      expect(paneIdsOf()).toHaveLength(1);
      expect(tab().focusedPaneId).toBe(paneIdsOf()[0]);
      expect(tab().broadcast).toBe(false);
    });

    it("splits terminal tabs only, focusing the new pane", () => {
      state().openLocalTab();
      const first = tab().focusedPaneId;
      state().splitPane(tab().id, "row");
      expect(paneIdsOf()).toHaveLength(2);
      expect(tab().focusedPaneId).not.toBe(first);

      state().openSftpTab(host("a"), null);
      const sftp = state().tabs[1]!;
      state().splitPane(sftp.id, "row");
      expect(state().tabs[1]!.layout).toEqual(sftp.layout);
    });

    it("moves focus between panes and resizes splits", () => {
      state().openLocalTab();
      const left = tab().focusedPaneId;
      state().splitPane(tab().id, "row");
      const right = tab().focusedPaneId;
      state().focusNeighbour(tab().id, "left");
      expect(tab().focusedPaneId).toBe(left);
      state().focusNeighbour(tab().id, "left");
      expect(tab().focusedPaneId).toBe(left);
      state().focusPane(tab().id, right);
      expect(tab().focusedPaneId).toBe(right);
      state().focusPane(tab().id, "nope");
      expect(tab().focusedPaneId).toBe(right);

      const layout = tab().layout;
      if (layout.kind !== "split") throw new Error("expected a split");
      state().setSplitRatio(tab().id, layout.id, 0.3);
      expect(tab().layout).toMatchObject({ ratio: 0.3 });
    });

    it("closing a pane refocuses a neighbour; closing the last one closes the tab", () => {
      state().openLocalTab();
      const left = tab().focusedPaneId;
      state().splitPane(tab().id, "row");
      const right = tab().focusedPaneId;
      state().closePane(tab().id, right);
      expect(paneIdsOf()).toEqual([left]);
      expect(tab().focusedPaneId).toBe(left);

      state().closePane(tab().id, left);
      expect(state().tabs).toEqual([]);
    });

    it("reports connected while any pane is connected", () => {
      state().openLocalTab();
      const left = tab().focusedPaneId;
      state().splitPane(tab().id, "row");
      const right = tab().focusedPaneId;
      state().setPaneStatus(tab().id, left, "connected");
      state().setPaneStatus(tab().id, right, "connecting");
      expect(tab().status).toBe("connected");
      state().setPaneStatus(tab().id, left, "disconnected");
      expect(tab().status).toBe("connecting");
      state().closePane(tab().id, right);
      expect(tab().status).toBe("disconnected");
    });

    it("broadcast needs two panes and turns off when only one is left", () => {
      state().openLocalTab();
      state().toggleBroadcast(tab().id);
      expect(tab().broadcast).toBe(false);
      state().splitPane(tab().id, "column");
      state().toggleBroadcast(tab().id);
      expect(tab().broadcast).toBe(true);
      state().closePane(tab().id, tab().focusedPaneId);
      expect(tab().broadcast).toBe(false);
    });
  });
});

function paneIdsOf(): string[] {
  const collect = (node: import("@/features/panes/pane-tree").PaneNode): string[] =>
    node.kind === "pane" ? [node.id] : [...collect(node.first), ...collect(node.second)];
  return collect(useTabsStore.getState().tabs[0]!.layout);
}

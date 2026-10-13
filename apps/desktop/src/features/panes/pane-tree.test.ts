import { describe, expect, it } from "vitest";

import { closePane, neighbour, paneIds, paneRects, setRatio, singlePane, splitDividers, splitPane, type PaneNode } from "./pane-tree";

// a | b, with b split into b (top) / c (bottom)
const threePanes = (): PaneNode => splitPane(splitPane(singlePane("a"), "a", "row", "b", "s1"), "b", "column", "c", "s2");

describe("pane tree", () => {
  it("splits a pane into two, keeping order", () => {
    const tree = threePanes();
    expect(paneIds(tree)).toEqual(["a", "b", "c"]);
    expect(paneRects(tree).get("c")).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(splitPane(tree, "missing", "row", "x", "s3")).toEqual(tree);
  });

  it("closing a pane lets its sibling take the space, and the last close empties the tab", () => {
    const tree = threePanes();
    const withoutB = closePane(tree, "b");
    expect(withoutB).not.toBeNull();
    expect(paneIds(withoutB!)).toEqual(["a", "c"]);
    expect(paneRects(withoutB!).get("c")).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(closePane(singlePane("a"), "a")).toBeNull();
    expect(closePane(singlePane("a"), "b")).toEqual(singlePane("a"));
  });

  it("clamps divider positions", () => {
    const tree = setRatio(threePanes(), "s1", 0.99);
    expect(paneRects(tree).get("a")?.w).toBeCloseTo(0.85);
    expect(paneRects(setRatio(tree, "s1", 0)).get("a")?.w).toBeCloseTo(0.15);
    expect(paneRects(setRatio(tree, "s2", 0.3)).get("b")?.h).toBeCloseTo(0.3);
  });

  it("moves focus to the touching pane in each direction", () => {
    const tree = threePanes();
    expect(neighbour(tree, "a", "right")).toBe("b");
    expect(neighbour(tree, "b", "down")).toBe("c");
    expect(neighbour(tree, "c", "up")).toBe("b");
    expect(neighbour(tree, "c", "left")).toBe("a");
    expect(neighbour(tree, "a", "left")).toBeNull();
    expect(neighbour(tree, "a", "up")).toBeNull();
    expect(neighbour(tree, "zzz", "up")).toBeNull();
  });

  it("prefers the neighbour sharing the longest edge", () => {
    // a (left, full height) | b/c with b taking 70% of the height
    const tree = setRatio(threePanes(), "s2", 0.7);
    expect(neighbour(tree, "a", "right")).toBe("b");
  });

  it("lists dividers with the area each one splits", () => {
    expect(splitDividers(singlePane("a"))).toEqual([]);
    expect(splitDividers(threePanes())).toEqual([
      { splitId: "s1", direction: "row", area: { x: 0, y: 0, w: 1, h: 1 }, ratio: 0.5 },
      { splitId: "s2", direction: "column", area: { x: 0.5, y: 0, w: 0.5, h: 1 }, ratio: 0.5 },
    ]);
  });
});

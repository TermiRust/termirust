import { describe, expect, it } from "vitest";

import { splitVisibleTabs, tabCapacity } from "./tab-overflow";

const tabs = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("tab overflow", () => {
  it("fits as many minimum-width tabs as the bar allows", () => {
    expect(tabCapacity(500)).toBe(5);
    expect(tabCapacity(300)).toBe(3);
    expect(tabCapacity(50)).toBe(1);
    expect(tabCapacity(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("shows every tab while they fit", () => {
    expect(splitVisibleTabs(tabs, "a", 10)).toEqual({ shown: tabs, hidden: [] });
  });

  it("moves the extra tabs behind the overflow button, keeping order", () => {
    const { shown, hidden } = splitVisibleTabs(tabs, "b", 3);
    expect(ids(shown)).toEqual(["a", "b", "c"]);
    expect(ids(hidden)).toEqual(["d", "e"]);
  });

  it("always keeps the active tab visible", () => {
    const { shown, hidden } = splitVisibleTabs(tabs, "e", 3);
    expect(ids(shown)).toEqual(["a", "b", "e"]);
    expect(ids(hidden)).toEqual(["c", "d"]);
    expect(ids(splitVisibleTabs(tabs, "e", 1).shown)).toEqual(["e"]);
  });
});

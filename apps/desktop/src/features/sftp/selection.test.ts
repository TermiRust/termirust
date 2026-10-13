import { describe, expect, it } from "vitest";

import { nextSelection, stepSelection } from "./selection";

const paths = ["/a", "/b", "/c", "/d"];
const plain = { toggle: false, range: false };

describe("selection", () => {
  it("selects only the clicked item by default", () => {
    expect(nextSelection(paths, ["/a", "/b"], "/a", "/c", plain)).toEqual(["/c"]);
  });

  it("toggles with the modifier key", () => {
    expect(nextSelection(paths, ["/a"], "/a", "/c", { toggle: true, range: false })).toEqual(["/a", "/c"]);
    expect(nextSelection(paths, ["/a", "/c"], "/a", "/a", { toggle: true, range: false })).toEqual(["/c"]);
  });

  it("selects a range from the anchor in either direction", () => {
    expect(nextSelection(paths, ["/b"], "/b", "/d", { toggle: false, range: true })).toEqual(["/b", "/c", "/d"]);
    expect(nextSelection(paths, ["/c"], "/c", "/a", { toggle: false, range: true })).toEqual(["/a", "/b", "/c"]);
    expect(nextSelection(paths, [], null, "/b", { toggle: false, range: true })).toEqual(["/b"]);
  });

  it("steps with the arrow keys and stops at the ends", () => {
    expect(stepSelection(paths, [], 1)).toEqual(["/a"]);
    expect(stepSelection(paths, [], -1)).toEqual(["/d"]);
    expect(stepSelection(paths, ["/b"], 1)).toEqual(["/c"]);
    expect(stepSelection(paths, ["/a"], -1)).toEqual(["/a"]);
    expect(stepSelection([], ["/a"], 1)).toEqual([]);
  });
});

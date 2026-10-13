import { beforeEach, describe, expect, it } from "vitest";

import { useLayoutStore } from "./layout-store";

const initialState = useLayoutStore.getState();

describe("layout store", () => {
  beforeEach(() => {
    useLayoutStore.setState(initialState, true);
  });

  it("starts with the sidebar visible and an empty filter", () => {
    expect(useLayoutStore.getState().sidebarVisible).toBe(true);
    expect(useLayoutStore.getState().hostFilter).toBe("");
  });

  it("toggles sidebar visibility back and forth", () => {
    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarVisible).toBe(false);
    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarVisible).toBe(true);
  });

  it("stores the host filter text", () => {
    useLayoutStore.getState().setHostFilter("prod");
    expect(useLayoutStore.getState().hostFilter).toBe("prod");
  });
});

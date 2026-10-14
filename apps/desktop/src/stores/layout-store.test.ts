import { beforeEach, describe, expect, it } from "vitest";

import { useLayoutStore } from "./layout-store";

const initialState = useLayoutStore.getState();

describe("layout store", () => {
  beforeEach(() => {
    useLayoutStore.setState(initialState, true);
  });

  it("starts on the welcome screen with the sidebar visible", () => {
    expect(useLayoutStore.getState().sidebarVisible).toBe(true);
    expect(useLayoutStore.getState().section).toBe("hosts");
  });

  it("toggles sidebar visibility back and forth", () => {
    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarVisible).toBe(false);
    useLayoutStore.getState().toggleSidebar();
    expect(useLayoutStore.getState().sidebarVisible).toBe(true);
  });
});

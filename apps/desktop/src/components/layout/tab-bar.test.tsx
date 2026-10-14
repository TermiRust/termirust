import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostView } from "@/bindings";
import { useTabsStore } from "@/stores/tabs-store";

import { TabBar } from "./tab-bar";

const host = (id: string): HostView => ({
  id,
  label: id,
  hostname: id,
  port: 22,
  username: null,
  auth: { method: "agent" },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null, aiDisabled: false, os: null, environment: null,
color: null,
});
const initial = useTabsStore.getState();
const store = () => useTabsStore.getState();

function setup() {
  const a = store().openHostTab(host("prod-api"), "red");
  const b = store().openHostTab(host("staging"), null);
  const onRequestClose = vi.fn();
  render(<TabBar onRequestClose={onRequestClose} onNewLocalTab={() => store().openLocalTab()} />);
  return { a, b, onRequestClose, user: userEvent.setup() };
}

describe("TabBar", () => {
  beforeEach(() => useTabsStore.setState(initial, true));

  it("lists tabs with their status and marks the active one", () => {
    const { b } = setup();
    const tabs = within(screen.getByRole("tablist", { name: "Sessions" })).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["prod-api (connecting)", "staging (connecting)"]);
    expect(screen.getByRole("tab", { selected: true })).toHaveAttribute("id", `tab-${b}`);
  });

  it("activates a tab on click", async () => {
    const { a, user } = setup();
    await user.click(screen.getByRole("tab", { name: /prod-api/ }));
    expect(store().activeTabId).toBe(a);
  });

  it("moves between tabs with the arrow keys", async () => {
    const { a, user } = setup();
    screen.getByRole("tab", { selected: true }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(store().activeTabId).toBe(a);
  });

  it("asks the parent to close a tab", async () => {
    const { onRequestClose, user } = setup();
    await user.click(screen.getByRole("button", { name: "Close staging" }));
    expect(onRequestClose).toHaveBeenCalledWith(expect.objectContaining({ title: "staging" }));
  });

  it("renames a tab by double-click, Enter commits and Escape cancels", async () => {
    const { user } = setup();
    await user.dblClick(screen.getByRole("tab", { name: /staging/ }));
    const input = screen.getByRole("textbox", { name: "Tab name" });
    await user.clear(input);
    await user.type(input, "worker logs{Enter}");
    expect(store().tabs[1]?.title).toBe("worker logs");

    await user.dblClick(screen.getByRole("tab", { name: /worker logs/ }));
    await user.type(screen.getByRole("textbox", { name: "Tab name" }), "zzz{Escape}");
    expect(store().tabs[1]?.title).toBe("worker logs");
  });

  it("renames with F2", async () => {
    const { user } = setup();
    screen.getByRole("tab", { selected: true }).focus();
    await user.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: "Tab name" })).toHaveValue("staging");
  });

  it("reorders tabs by drag and drop", () => {
    const { b } = setup();
    const tabs = screen.getAllByRole("tab").map((t) => t.closest("[draggable]")!);
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "" };

    fireEvent.dragStart(tabs[1]!, { dataTransfer });
    fireEvent.dragOver(tabs[0]!, { dataTransfer });
    fireEvent.drop(tabs[0]!, { dataTransfer });

    expect(store().tabs.map((t) => t.id)[0]).toBe(b);
  });

  it("opens a local terminal from the + button", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New local terminal" }));
    expect(store().tabs.at(-1)).toMatchObject({ title: "Local", target: { kind: "local" } });
  });

  it("shows disconnected tabs dimmed in italics", () => {
    const { a } = setup();
    act(() => store().setTabStatus(a, "disconnected"));
    expect(screen.getByRole("tab", { name: "prod-api (disconnected)" }).className).toContain("italic");
  });

  it("shows a status dot on host tabs and a wifi-off mark when the link is lost", () => {
    const id = store().openHostTab(host("a"), null);
    render(<TabBar onRequestClose={vi.fn()} onNewLocalTab={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Connecting" })).toBeInTheDocument();
    act(() => store().setTabStatus(id, "connected"));
    expect(screen.getByRole("img", { name: "Connected" })).toBeInTheDocument();
    act(() => store().setTabStatus(id, "disconnected"));
    expect(screen.getByLabelText("Disconnected")).toBeInTheDocument();
  });

  // Regression: an older status dot was left next to the new one, so host tabs showed two.
  it("shows exactly one status mark per host tab and none on local tabs", () => {
    const hostTab = store().openHostTab(host("a"), "red");
    store().openLocalTab();
    act(() => store().setTabStatus(hostTab, "connected"));
    render(<TabBar onRequestClose={vi.fn()} onNewLocalTab={vi.fn()} />);
    const [hostEl, localEl] = screen.getAllByRole("tab");
    const dots = (el: HTMLElement) => el.closest('[role="presentation"], div')!.querySelectorAll(".rounded-full");
    expect(dots(hostEl!)).toHaveLength(1);
    expect(within(hostEl!).getByRole("img", { name: "Connected" })).toBeInTheDocument();
    expect(dots(localEl!)).toHaveLength(0);
  });

  describe("when tabs no longer fit", () => {
    let resize: () => void = () => {};
    beforeEach(() => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            resize = callback;
          }
          observe() {
            resize();
          }
          disconnect() {}
        },
      );
      // Room for three tabs at the 96px minimum.
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("shrinks tabs, hides the rest behind a +N button, and keeps the active tab visible", () => {
      for (const id of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]) store().openHostTab(host(id), null);
      render(<TabBar onRequestClose={vi.fn()} onNewLocalTab={vi.fn()} />);
      const names = screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"));
      expect(names).toEqual(["alpha (connecting)", "bravo (connecting)", "foxtrot (connecting)"]);
      expect(screen.getByRole("button", { name: "3 more tabs" })).toHaveTextContent("+3");
    });

    it("lists every tab in a searchable switcher and activates the chosen one", async () => {
      for (const id of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]) store().openHostTab(host(id), null);
      render(<TabBar onRequestClose={vi.fn()} onNewLocalTab={vi.fn()} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "3 more tabs" }));
      const dialog = within(await screen.findByRole("dialog", { name: "Open tabs" }));
      expect(dialog.getAllByRole("option")).toHaveLength(6);

      await user.type(dialog.getByRole("combobox", { name: "Search open tabs" }), "char");
      expect(dialog.getAllByRole("option")).toHaveLength(1);
      await user.keyboard("{Enter}");
      expect(store().tabs.find((t) => t.id === store().activeTabId)?.title).toBe("charlie");
      expect(screen.queryByRole("dialog", { name: "Open tabs" })).not.toBeInTheDocument();
    });
  });
});

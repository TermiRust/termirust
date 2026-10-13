import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutStore } from "@/stores/layout-store";
import { useTabsStore } from "@/stores/tabs-store";

vi.mock("@/bindings", () => ({
  commands: {
    appVersion: () => Promise.resolve("0.0.1"),
    hostsList: () => Promise.resolve({ status: "ok", data: [] }),
    groupsList: () => Promise.resolve({ status: "ok", data: [] }),
    settingsTerminalGet: () => Promise.resolve({ status: "ok", data: {} }),
  },
}));
vi.mock("@/features/session/local-session-view", () => ({ LocalSessionView: () => <div>local shell</div> }));
vi.mock("@/features/connection-lab/connection-lab", () => ({
  ConnectionLab: ({ onExit }: { onExit: () => void }) => (
    <button type="button" onClick={onExit}>
      Leave lab
    </button>
  ),
}));

const { AppShell } = await import("./app-shell");
const initialState = useLayoutStore.getState();
const initialTabs = useTabsStore.getState();

describe("AppShell", () => {
  beforeEach(() => {
    useLayoutStore.setState(initialState, true);
    useTabsStore.setState(initialTabs, true);
  });

  it("shows the empty workspace with the backend version", async () => {
    render(<AppShell />);
    expect(screen.getByText(/No open sessions/)).toBeInTheDocument();
    expect(await screen.findByText("v0.0.1")).toBeInTheDocument();
  });

  it("hides and shows the sidebar with the platform shortcut", () => {
    render(<AppShell />);
    expect(screen.getByRole("complementary", { name: "Hosts sidebar" })).toBeInTheDocument();

    const onMac = /Mac/i.test(navigator.userAgent);
    const chord = onMac ? { metaKey: true } : { ctrlKey: true, shiftKey: true };

    act(() => {
      fireEvent.keyDown(window, { key: "b", ...chord });
    });
    expect(screen.queryByRole("complementary", { name: "Hosts sidebar" })).not.toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: "b", ...chord });
    });
    expect(screen.getByRole("complementary", { name: "Hosts sidebar" })).toBeInTheDocument();
  });

  it("does not toggle the sidebar on a plain Ctrl+B meant for the shell", () => {
    render(<AppShell />);
    act(() => {
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    });
    expect(screen.getByRole("complementary", { name: "Hosts sidebar" })).toBeInTheDocument();
  });

  it("writes the host filter into the layout store", async () => {
    render(<AppShell />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter hosts" }), "prod");
    expect(useLayoutStore.getState().hostFilter).toBe("prod");
  });

  it("switches between the empty workspace and the connection lab", async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByRole("button", { name: "Open connection lab" }));
    expect(screen.queryByText(/No open sessions/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Leave lab" }));
    expect(screen.getByText(/No open sessions/)).toBeInTheDocument();
  });
});

describe("AppShell tabs", () => {
  const initialTabs = useTabsStore.getState();
  beforeEach(() => useTabsStore.setState(initialTabs, true));

  it("asks before closing a connected tab with the keyboard shortcut", async () => {
    const id = useTabsStore.getState().openLabTab();
    useTabsStore.getState().setTabStatus(id, "connected");
    render(<AppShell />);
    const onMac = /Mac/i.test(navigator.userAgent);
    fireEvent.keyDown(window, onMac ? { key: "w", metaKey: true } : { key: "w", ctrlKey: true, shiftKey: true });

    const dialog = await screen.findByRole("dialog", { name: /Close Connection lab/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Close tab" }));
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(screen.getByText(/No open sessions/)).toBeInTheDocument();
  });

  it("closes a tab that is not connected without asking", async () => {
    useTabsStore.getState().openLabTab();
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: "Close Connection lab" }));
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("switches tabs by number shortcut", () => {
    const first = useTabsStore.getState().openLabTab();
    useTabsStore.getState().openLabTab();
    render(<AppShell />);
    const onMac = /Mac/i.test(navigator.userAgent);
    act(() => {
      fireEvent.keyDown(window, onMac ? { key: "1", metaKey: true } : { key: "1", altKey: true });
    });
    expect(useTabsStore.getState().activeTabId).toBe(first);
  });

  it("opens a local terminal with the new-tab shortcut", () => {
    render(<AppShell />);
    const onMac = /Mac/i.test(navigator.userAgent);
    act(() => {
      fireEvent.keyDown(window, onMac ? { key: "t", metaKey: true } : { key: "t", ctrlKey: true, shiftKey: true });
    });
    expect(useTabsStore.getState().tabs.map((t) => t.target.kind)).toEqual(["local"]);
  });
});

describe("AppShell command palette", () => {
  it("opens with the platform shortcut and lists commands", async () => {
    render(<AppShell />);
    const onMac = /Mac/i.test(navigator.userAgent);
    act(() => {
      fireEvent.keyDown(window, onMac ? { key: "k", metaKey: true } : { key: "k", ctrlKey: true, shiftKey: true });
    });
    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    expect(within(palette).getByText("New local terminal")).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutStore } from "@/stores/layout-store";

vi.mock("@/bindings", () => ({
  commands: {
    appVersion: () => Promise.resolve("0.0.1"),
    hostsList: () => Promise.resolve({ status: "ok", data: [] }),
    groupsList: () => Promise.resolve({ status: "ok", data: [] }),
  },
}));
vi.mock("@/features/connection-lab/connection-lab", () => ({
  ConnectionLab: ({ onExit }: { onExit: () => void }) => (
    <button type="button" onClick={onExit}>
      Leave lab
    </button>
  ),
}));

const { AppShell } = await import("./app-shell");
const initialState = useLayoutStore.getState();

describe("AppShell", () => {
  beforeEach(() => {
    useLayoutStore.setState(initialState, true);
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

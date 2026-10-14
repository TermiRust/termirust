import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = { hostsList: vi.fn(), groupsList: vi.fn(), vaultRetryOpen: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { Sidebar } = await import("./sidebar");
const { useHostsStore } = await import("@/stores/hosts-store");
const { useLayoutStore } = await import("@/stores/layout-store");
const { useTabsStore } = await import("@/stores/tabs-store");
const { useDialogsStore } = await import("@/stores/dialogs-store");

const ok = <T,>(data: T) => ({ status: "ok", data });
const initialHosts = useHostsStore.getState();
const initialLayout = useLayoutStore.getState();

describe("Sidebar", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
    useHostsStore.setState({ ...initialHosts, loaded: true, error: null }, true);
    useLayoutStore.setState(initialLayout, true);
    useTabsStore.setState({ tabs: [], activeTabId: null });
  });

  it("is only the list of sections: no host list or host search", () => {
    render(<Sidebar />);
    const sections = screen.getByRole("navigation", { name: "Sections" });
    expect(Array.from(sections.querySelectorAll("button")).map((b) => b.textContent?.trim())).toEqual([
      "Hosts",
      "Terminals",
      "SFTP",
      "Monitor",
      "Snippets",
      "Port forwarding",
      "Keychain",
    ]);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Hosts" })).not.toBeInTheDocument();
  });

  it("switches screens and marks the current one", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    for (const [label, section] of [
      ["Hosts", "library"],
      ["Monitor", "monitor"],
      ["Port forwarding", "forwards"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(useLayoutStore.getState().section).toBe(section);
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  it("counts open terminals", () => {
    render(<Sidebar />);
    act(() => {
      useTabsStore.getState().openLocalTab();
    });
    expect(screen.getByRole("button", { name: /Terminals/ })).toHaveTextContent("1");
  });

  it("opens the new host dialog", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole("button", { name: "New host" }));
    expect(useDialogsStore.getState().hostEditor).toEqual({ mode: "new" });
  });

  it("says the vault is unlocking until the first load finishes", () => {
    useHostsStore.setState({ loaded: false });
    render(<Sidebar />);
    expect(screen.getByRole("status")).toHaveTextContent("Unlocking vault…");
  });

  it("shows a vault error and recovers with Try again", async () => {
    useHostsStore.setState({ loaded: true, error: "OS keychain error: keychain access denied" });
    commands.vaultRetryOpen.mockResolvedValue(ok(null));
    commands.hostsList.mockResolvedValue(ok([]));
    commands.groupsList.mockResolvedValue(ok([]));
    render(<Sidebar />);
    expect(screen.getByRole("alert")).toHaveTextContent("keychain access denied");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(commands.vaultRetryOpen).toHaveBeenCalled();
  });
});

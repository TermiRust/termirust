import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Topbar } from "./topbar";

function setup(onMac: boolean, settingsActive = false) {
  const handlers = { onSearch: vi.fn(), onToggleSidebar: vi.fn(), onOpenSettings: vi.fn() };
  render(<Topbar onMac={onMac} paletteShortcut={onMac ? "⌘K" : "Ctrl+Shift+K"} sidebarShortcut="⌘B" settingsActive={settingsActive} {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}

describe("Topbar", () => {
  it("opens search, toggles the sidebar and opens settings", async () => {
    const { user, onSearch, onToggleSidebar, onOpenSettings } = setup(true);
    await user.click(screen.getByRole("button", { name: "Search hosts and commands" }));
    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onToggleSidebar).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("leaves room for the macOS traffic lights and drags the window from empty space", () => {
    setup(true);
    const bar = screen.getByRole("banner", { name: "Top bar" });
    expect(bar).toHaveAttribute("data-tauri-drag-region");
    expect(bar.className).toMatch(/pl-\[78px\]/);
  });

  it("shows the platform shortcut and the active state of settings elsewhere", () => {
    setup(false, true);
    expect(screen.getByText("Ctrl+Shift+K")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("banner", { name: "Top bar" }).className).not.toMatch(/78px/);
  });
});

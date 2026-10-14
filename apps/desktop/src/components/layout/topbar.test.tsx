import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./window-controls", () => ({ WindowControls: () => <div>window controls</div> }));

const { Topbar } = await import("./topbar");

function setup(onMac: boolean) {
  const handlers = { onSearch: vi.fn(), onToggleSidebar: vi.fn() };
  render(<Topbar onMac={onMac} paletteShortcut={onMac ? "⌘K" : "Ctrl+Shift+K"} sidebarShortcut="⌘B" {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}

describe("Topbar", () => {
  it("opens search and toggles the sidebar; Settings moved to the sidebar", async () => {
    const { user, onSearch, onToggleSidebar } = setup(true);
    await user.click(screen.getByRole("button", { name: "Search hosts and commands" }));
    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onToggleSidebar).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("leaves room for the macOS traffic lights and drags the window from empty space", () => {
    setup(true);
    const bar = screen.getByRole("banner", { name: "Top bar" });
    expect(bar).toHaveAttribute("data-tauri-drag-region");
    expect(bar.className).toMatch(/pl-\[78px\]/);
  });

  it("shows the platform shortcut elsewhere", () => {
    setup(false);
    expect(screen.getByText("Ctrl+Shift+K")).toBeInTheDocument();
    expect(screen.getByRole("banner", { name: "Top bar" }).className).not.toMatch(/78px/);
  });

  it("draws window buttons only when asked (Windows, frameless)", () => {
    const { rerender } = render(<Topbar onMac={false} paletteShortcut="Ctrl+Shift+K" sidebarShortcut="Ctrl+Shift+B" onSearch={vi.fn()} onToggleSidebar={vi.fn()} />);
    expect(screen.queryByText("window controls")).not.toBeInTheDocument();
    rerender(<Topbar onMac={false} windowControls paletteShortcut="Ctrl+Shift+K" sidebarShortcut="Ctrl+Shift+B" onSearch={vi.fn()} onToggleSidebar={vi.fn()} />);
    expect(screen.getByText("window controls")).toBeInTheDocument();
  });
});

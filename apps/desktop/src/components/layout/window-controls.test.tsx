import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const win = {
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn(),
  onResized: vi.fn(),
};
let resized: () => void = () => {};
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));

const { WindowControls } = await import("./window-controls");

describe("WindowControls", () => {
  beforeEach(() => {
    Object.values(win).forEach((fn) => fn.mockReset());
    win.isMaximized.mockResolvedValue(false);
    win.onResized.mockImplementation(async (handler: () => void) => {
      resized = handler;
      return () => {};
    });
  });

  it("minimises, maximises and closes the window", async () => {
    const user = userEvent.setup();
    render(<WindowControls />);
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(await screen.findByRole("button", { name: "Maximize" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(win.minimize).toHaveBeenCalledOnce();
    expect(win.toggleMaximize).toHaveBeenCalledOnce();
    expect(win.close).toHaveBeenCalledOnce();
  });

  it("offers Restore while the window is maximised", async () => {
    render(<WindowControls />);
    await screen.findByRole("button", { name: "Maximize" });
    win.isMaximized.mockResolvedValue(true);
    await act(async () => resized());
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
  });
});

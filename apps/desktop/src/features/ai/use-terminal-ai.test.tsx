import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
vi.mock("@/bindings", () => ({ commands: {} }));

const { useTerminalAi } = await import("./use-terminal-ai");

function Harness({ allowed, selection }: { allowed: boolean; selection: string }) {
  const ai = useTerminalAi({ allowed, target: "local", hostId: null, insert: vi.fn(), focusTerminal: vi.fn() });
  return (
    <div>
      <div data-testid="terminal" onContextMenu={(e) => ai.onContextMenu(e, selection)} />
      <button type="button" onClick={() => ai.onAskAi?.(selection)} disabled={!ai.onAskAi}>
        shortcut
      </button>
      {ai.commandBar}
      {ai.explainPanel}
      {ai.contextMenu}
    </div>
  );
}

describe("useTerminalAi", () => {
  it("opens the command bar without a selection and the explain panel with one", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness allowed selection="" />);
    await user.click(screen.getByRole("button", { name: "shortcut" }));
    expect(screen.getByRole("dialog", { name: "Ask AI for a command" })).toBeInTheDocument();

    rerender(<Harness allowed selection="segfault at 0x0" />);
    await user.click(screen.getByRole("button", { name: "shortcut" }));
    expect(screen.getByRole("complementary", { name: "Ask AI about the selection" })).toBeInTheDocument();
  });

  it("offers Ask AI on right-click over a selection", async () => {
    const user = userEvent.setup();
    render(<Harness allowed selection="permission denied" />);
    fireEvent.contextMenu(screen.getByTestId("terminal"));
    await user.click(screen.getByRole("menuitem", { name: "Ask AI about selection" }));
    expect(screen.getByLabelText("Selected output")).toHaveTextContent("permission denied");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does nothing when AI is not allowed or nothing is selected", () => {
    const { rerender } = render(<Harness allowed={false} selection="x" />);
    expect(screen.getByRole("button", { name: "shortcut" })).toBeDisabled();
    fireEvent.contextMenu(screen.getByTestId("terminal"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    rerender(<Harness allowed selection="   " />);
    fireEvent.contextMenu(screen.getByTestId("terminal"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

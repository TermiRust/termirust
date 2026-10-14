import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TerminalExcerpt } from "@/features/terminal/terminal-view";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { aiChatsList: async () => ({ status: "ok", data: [] }) } }));

const { useTerminalAi, lineLabel } = await import("./use-terminal-ai");

function Harness({ allowed, excerpt }: { allowed: boolean; excerpt: TerminalExcerpt | null }) {
  const ai = useTerminalAi({ allowed, target: "local", hostId: null, hostLabel: "Local", insert: vi.fn(), focusTerminal: vi.fn(), readScreen: () => null });
  return (
    <div>
      <div data-testid="terminal" onContextMenu={(e) => ai.onContextMenu(e, excerpt)} />
      <button type="button" onClick={() => ai.onAskAi?.(excerpt)} disabled={!ai.onAskAi}>
        shortcut
      </button>
      {ai.panel}
      {ai.contextMenu}
    </div>
  );
}

const error: TerminalExcerpt = { text: "permission denied", startLine: 35, endLine: 55 };

describe("useTerminalAi", () => {
  it("labels quotes by their terminal lines", () => {
    expect(lineLabel(error)).toBe("L35–L55");
    expect(lineLabel({ text: "x", startLine: 7, endLine: 7 })).toBe("L7");
  });

  it("opens the side panel from the shortcut, quoting the selection", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness allowed excerpt={null} />);
    await user.click(screen.getByRole("button", { name: "shortcut" }));
    expect(screen.getByRole("complementary", { name: "AI assistant" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Attached" })).not.toBeInTheDocument();

    rerender(<Harness allowed excerpt={error} />);
    await user.click(screen.getByRole("button", { name: "shortcut" }));
    expect(screen.getByRole("button", { name: "Quoted L35–L55" })).toBeInTheDocument();
  });

  it("quotes from the right-click menu", async () => {
    const user = userEvent.setup();
    render(<Harness allowed excerpt={error} />);
    fireEvent.contextMenu(screen.getByTestId("terminal"));
    await user.click(screen.getByRole("menuitem", { name: "Ask AI about selection" }));
    expect(screen.getByRole("button", { name: "Quoted L35–L55" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does nothing when AI is not allowed or nothing is selected", () => {
    const { rerender } = render(<Harness allowed={false} excerpt={error} />);
    expect(screen.getByRole("button", { name: "shortcut" })).toBeDisabled();
    fireEvent.contextMenu(screen.getByTestId("terminal"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    rerender(<Harness allowed excerpt={null} />);
    fireEvent.contextMenu(screen.getByTestId("terminal"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

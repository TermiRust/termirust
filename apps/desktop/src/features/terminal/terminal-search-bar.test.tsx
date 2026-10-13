import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TerminalSearchBar } from "./terminal-search-bar";

function fakeSearch() {
  let listener: (r: { resultIndex: number; resultCount: number }) => void = () => {};
  return {
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn(),
    onDidChangeResults: (cb: typeof listener) => {
      listener = cb;
      return { dispose: vi.fn() };
    },
    report: (resultIndex: number, resultCount: number) => act(() => listener({ resultIndex, resultCount })),
  };
}

describe("TerminalSearchBar", () => {
  it("searches as you type and shows the match position", async () => {
    const search = fakeSearch();
    const user = userEvent.setup();
    render(<TerminalSearchBar search={search} onClose={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "Find" }), "err");
    expect(search.findNext).toHaveBeenLastCalledWith("err", expect.objectContaining({ incremental: true, caseSensitive: false }));

    search.report(1, 4);
    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    search.report(-1, 0);
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("Enter goes to the next match, Shift+Enter to the previous, buttons do the same", async () => {
    const search = fakeSearch();
    const user = userEvent.setup();
    render(<TerminalSearchBar search={search} onClose={vi.fn()} />);
    await user.type(screen.getByRole("textbox", { name: "Find" }), "x");
    search.findNext.mockClear();

    await user.keyboard("{Enter}");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.click(screen.getByRole("button", { name: "Next match" }));
    await user.click(screen.getByRole("button", { name: "Previous match" }));
    expect(search.findNext).toHaveBeenCalledTimes(2);
    expect(search.findPrevious).toHaveBeenCalledTimes(2);
  });

  it("toggles case sensitivity", async () => {
    const search = fakeSearch();
    const user = userEvent.setup();
    render(<TerminalSearchBar search={search} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Match case" }));
    expect(screen.getByRole("button", { name: "Match case" })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByRole("textbox", { name: "Find" }), "E");
    expect(search.findNext).toHaveBeenLastCalledWith("E", expect.objectContaining({ caseSensitive: true }));
  });

  it("clears highlights when emptied and closes with Escape", async () => {
    const search = fakeSearch();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(<TerminalSearchBar search={search} onClose={onClose} />);
    await user.type(screen.getByRole("textbox", { name: "Find" }), "a{Backspace}");
    expect(search.clearDecorations).toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(search.clearDecorations).toHaveBeenCalledTimes(2);
  });
});

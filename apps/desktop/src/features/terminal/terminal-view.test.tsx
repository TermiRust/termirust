import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TERMINAL_SETTINGS, useSettingsStore } from "@/stores/settings-store";

interface FakeTerminal {
  options: Record<string, unknown>;
  pasted: string[];
  keyHandler: ((e: KeyboardEvent) => boolean) | null;
  selection: string;
  selectionListener: (() => void) | null;
}
const terminals: FakeTerminal[] = [];
const opened: HTMLElement[] = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: class implements FakeTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    pasted: string[] = [];
    keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
    selection = "";
    selectionListener: (() => void) | null = null;
    unicode = { activeVersion: "" };
    constructor() {
      terminals.push(this);
    }
    loadAddon() {}
    open(el: HTMLElement) {
      opened.push(el);
    }
    attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean) {
      this.keyHandler = handler;
    }
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    onSelectionChange(listener: () => void) {
      this.selectionListener = listener;
      return { dispose() {} };
    }
    getSelection() {
      return this.selection;
    }
    paste(text: string) {
      this.pasted.push(text);
    }
    focus() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
    onDidChangeResults() {
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: vi.fn() }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: vi.fn() }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { settingsTerminalSet: (s: unknown) => Promise.resolve({ status: "ok", data: s }) } }));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

const { TerminalView } = await import("./terminal-view");
const { fitIfVisible } = await import("./fit-if-visible");
const initialSettings = useSettingsStore.getState();

function pasteInto(element: HTMLElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: () => string } };
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

describe("fitIfVisible", () => {
  const sized = (width: number, height: number) => {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetWidth", { value: width });
    Object.defineProperty(el, "offsetHeight", { value: height });
    return el;
  };

  // Regression: a hidden tab was resized to ~11 columns, leaving prompt fragments on screen.
  it("never resizes a terminal whose tab is hidden", () => {
    const fit = { fit: vi.fn() };
    fitIfVisible(fit, sized(0, 0));
    fitIfVisible(fit, sized(800, 0));
    expect(fit.fit).not.toHaveBeenCalled();
  });

  it("resizes once the tab is visible again", () => {
    const fit = { fit: vi.fn() };
    fitIfVisible(fit, sized(800, 600));
    expect(fit.fit).toHaveBeenCalledTimes(1);
  });
});

describe("TerminalView", () => {
  beforeEach(() => {
    opened.length = 0;
    terminals.length = 0;
    useSettingsStore.setState(initialSettings, true);
  });

  // Padding on the mount element makes FitAddon oversize xterm, which oscillates scrollbars.
  it("mounts xterm into an element without padding inside a clipped, padded wrapper", () => {
    render(<TerminalView />);
    const mount = screen.getByTestId("terminal");
    expect(opened).toEqual([mount]);
    expect(mount.className).not.toMatch(/\bp[xytrbl]?-\d/);
    expect(mount.parentElement?.className).toMatch(/\boverflow-hidden\b/);
    expect(mount.parentElement?.className).toMatch(/\bp-2\b/);
  });

  it("applies the terminal settings and follows later changes", () => {
    render(<TerminalView />);
    const terminal = terminals[0]!;
    expect(terminal.options).toMatchObject({ fontSize: 13, cursorStyle: "block", scrollback: 10_000 });

    act(() => useSettingsStore.setState({ terminal: { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 16, theme: "dracula" } }));
    expect(terminal.options.fontSize).toBe(16);
    expect((terminal.options.theme as { background: string }).background).toBe("#282a36");
  });

  it("asks before pasting several lines and pastes on confirm", async () => {
    render(<TerminalView />);
    const event = pasteInto(screen.getByTestId("terminal"), "cd /srv\nrm -rf build\n");
    expect(event.defaultPrevented).toBe(true);

    expect(screen.getByRole("dialog", { name: "Paste 2 lines?" })).toHaveTextContent("rm -rf build");
    await userEvent.click(screen.getByRole("button", { name: "Paste" }));
    expect(terminals[0]!.pasted).toEqual(["cd /srv\nrm -rf build\n"]);
  });

  it("lets single-line pastes through, and multi-line ones when the guard is off", () => {
    render(<TerminalView />);
    expect(pasteInto(screen.getByTestId("terminal"), "ls -la").defaultPrevented).toBe(false);

    act(() => useSettingsStore.setState({ terminal: { ...DEFAULT_TERMINAL_SETTINGS, confirmMultilinePaste: false } }));
    expect(pasteInto(screen.getByTestId("terminal"), "a\nb").defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("always asks before multi-line pastes while broadcasting, even with the guard off", () => {
    act(() => useSettingsStore.setState({ terminal: { ...DEFAULT_TERMINAL_SETTINGS, confirmMultilinePaste: false } }));
    render(<TerminalView forcePasteConfirmation />);
    expect(pasteInto(screen.getByTestId("terminal"), "a\nb").defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Paste 2 lines?" })).toBeInTheDocument();
  });

  it("keeps app chords from the shell but lets Ctrl+D through", () => {
    render(<TerminalView />);
    const onMac = /Mac/i.test(navigator.userAgent);
    const split = new KeyboardEvent("keydown", onMac ? { key: "d", metaKey: true } : { key: "D", ctrlKey: true, shiftKey: true });
    expect(terminals[0]!.keyHandler!(split)).toBe(false);
    expect(terminals[0]!.keyHandler!(new KeyboardEvent("keydown", { key: "d", ctrlKey: true }))).toBe(true);
  });

  it("opens the search bar on the find shortcut instead of sending it to the shell", async () => {
    render(<TerminalView />);
    const onMac = /Mac/i.test(navigator.userAgent);
    const key = new KeyboardEvent("keydown", onMac ? { key: "f", metaKey: true } : { key: "f", ctrlKey: true, shiftKey: true });
    let forwarded = true;
    act(() => {
      forwarded = terminals[0]!.keyHandler!(key);
    });
    expect(forwarded).toBe(false);
    const bar = await screen.findByRole("search", { name: "Find in terminal" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), { key: "Escape" });
    await waitFor(() => expect(bar).not.toBeInTheDocument());

    expect(terminals[0]!.keyHandler!(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(true);
  });

  it("copies the selection when copy-on-select is on", async () => {
    // setup() installs a clipboard stub on navigator for the assertion below.
    userEvent.setup();
    act(() => useSettingsStore.setState({ terminal: { ...DEFAULT_TERMINAL_SETTINGS, copyOnSelect: true } }));
    render(<TerminalView />);
    terminals[0]!.selection = "uptime output";
    act(() => terminals[0]!.selectionListener!());
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("uptime output"));
  });
});

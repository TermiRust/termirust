import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const opened: HTMLElement[] = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    unicode = { activeVersion: "" };
    loadAddon() {}
    open(el: HTMLElement) {
      opened.push(el);
    }
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: vi.fn() }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: vi.fn() }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class { onContextLoss() {} dispose() {} } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

const { TerminalView } = await import("./terminal-view");

describe("TerminalView", () => {
  beforeEach(() => {
    opened.length = 0;
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
});

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalHandle {
  write: (data: Uint8Array | string, onWritten?: () => void) => void;
  clear: () => void;
  focus: () => void;
  size: () => TerminalSize;
}

interface TerminalViewProps {
  onData?: (data: string) => void;
  onResize?: (size: TerminalSize) => void;
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { onData, onResize },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  onDataRef.current = onData;
  onResizeRef.current = onResize;

  useImperativeHandle(ref, () => ({
    write: (data, onWritten) => terminalRef.current?.write(data, onWritten),
    clear: () => terminalRef.current?.reset(),
    focus: () => terminalRef.current?.focus(),
    size: () => ({ cols: terminalRef.current?.cols ?? 80, rows: terminalRef.current?.rows ?? 24 }),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 10_000,
      theme: { background: "#100e0b", foreground: "#ece8e1", cursor: "#fb923c" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.loadAddon(new WebLinksAddon((_event, uri) => void openUrl(uri)));
    terminal.open(container);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // No WebGL (e.g. some Linux drivers): xterm keeps its DOM renderer.
    }

    const dataSub = terminal.onData((d) => onDataRef.current?.(d));
    const resizeSub = terminal.onResize(({ cols, rows }) => onResizeRef.current?.({ cols, rows }));
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fit.fit());
    });
    observer.observe(container);
    fit.fit();
    terminalRef.current = terminal;

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full bg-[#100e0b] p-2" data-testid="terminal" />;
});

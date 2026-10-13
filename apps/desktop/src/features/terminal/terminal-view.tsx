import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { isAiShortcut, isFindShortcut, isMacPlatform } from "@/lib/shortcuts";
import { terminalTheme } from "@/lib/terminal-theme";
import { useSettingsStore, type ResolvedTerminalSettings } from "@/stores/settings-store";

import { needsPasteConfirmation } from "./paste-guard";
import { PasteConfirmDialog } from "./paste-confirm-dialog";
import { TerminalSearchBar } from "./terminal-search-bar";

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
  /** ⌘I / Ctrl+Shift+I, with whatever text is selected (often empty). */
  onAskAi?: (selection: string) => void;
}

function applySettings(terminal: Terminal, settings: ResolvedTerminalSettings) {
  terminal.options.fontFamily = settings.fontFamily;
  terminal.options.fontSize = settings.fontSize;
  terminal.options.lineHeight = settings.lineHeight;
  terminal.options.cursorStyle = settings.cursorStyle;
  terminal.options.cursorBlink = settings.cursorBlink;
  terminal.options.scrollback = settings.scrollback;
  terminal.options.theme = terminalTheme(settings.theme).colors;
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView({ onData, onResize, onAskAi }, ref) {
  const settings = useSettingsStore((s) => s.terminal);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const settingsRef = useRef(settings);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onAskAiRef = useRef(onAskAi);
  const [searching, setSearching] = useState(false);
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
    onDataRef.current = onData;
    onResizeRef.current = onResize;
    onAskAiRef.current = onAskAi;
  });

  useImperativeHandle(ref, () => ({
    write: (data, onWritten) => terminalRef.current?.write(data, onWritten),
    clear: () => terminalRef.current?.reset(),
    focus: () => terminalRef.current?.focus(),
    size: () => ({ cols: terminalRef.current?.cols ?? 80, rows: terminalRef.current?.rows ?? 24 }),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({ allowProposedApi: true });
    applySettings(terminal, settingsRef.current);
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
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

    const onMac = isMacPlatform();
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && isFindShortcut(event, onMac)) {
        setSearching(true);
        return false;
      }
      if (event.type === "keydown" && onAskAiRef.current && isAiShortcut(event, onMac)) {
        onAskAiRef.current(terminal.getSelection());
        return false;
      }
      return true;
    });

    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (needsPasteConfirmation(text, settingsRef.current.confirmMultilinePaste)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPendingPaste(text);
      }
    };
    container.addEventListener("paste", onPaste, true);

    const dataSub = terminal.onData((d) => onDataRef.current?.(d));
    const resizeSub = terminal.onResize(({ cols, rows }) => onResizeRef.current?.({ cols, rows }));
    const selectionSub = terminal.onSelectionChange(() => {
      const selected = terminal.getSelection();
      if (settingsRef.current.copyOnSelect && selected) void navigator.clipboard?.writeText(selected);
    });

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fit.fit());
    });
    observer.observe(container);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener("paste", onPaste, true);
      dataSub.dispose();
      resizeSub.dispose();
      selectionSub.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    applySettings(terminal, settings);
    fitRef.current?.fit();
  }, [settings]);

  const background = terminalTheme(settings.theme).colors.background;

  // FitAddon measures the mount element including its padding, so padding lives on the wrapper.
  return (
    <div className="relative h-full w-full overflow-hidden p-2" style={{ background }}>
      <div ref={containerRef} className="h-full w-full" data-testid="terminal" />
      {searching && searchRef.current && (
        <TerminalSearchBar
          search={searchRef.current}
          onClose={() => {
            setSearching(false);
            terminalRef.current?.focus();
          }}
        />
      )}
      {pendingPaste !== null && (
        <PasteConfirmDialog
          text={pendingPaste}
          onCancel={() => setPendingPaste(null)}
          onConfirm={() => {
            terminalRef.current?.paste(pendingPaste);
            setPendingPaste(null);
          }}
        />
      )}
    </div>
  );
});

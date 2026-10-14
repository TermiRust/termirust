import { useState, type MouseEvent, type ReactNode } from "react";

import type { AiTarget } from "@/bindings";
import type { TerminalExcerpt } from "@/features/terminal/terminal-view";

import { AiPanel } from "./ai-panel";
import { SelectionMenu } from "./selection-menu";
import { useAiChat, type ChatQuote } from "./use-ai-chat";

interface TerminalAiOptions {
  allowed: boolean;
  target: AiTarget;
  hostId: string | null;
  /** Shown in History, and kept there if the server is later deleted. */
  hostLabel: string;
  /** Types text on the prompt line; never adds Enter. */
  insert: (text: string) => void;
  focusTerminal: () => void;
  readScreen: () => TerminalExcerpt | null;
}

export const lineLabel = (e: TerminalExcerpt) => (e.startLine === e.endLine ? `L${e.startLine}` : `L${e.startLine}–L${e.endLine}`);
const toQuote = (e: TerminalExcerpt): ChatQuote => ({ label: lineLabel(e), text: e.text });

/** The AI side panel of a terminal tab, plus the right-click menu that quotes into it. */
export function useTerminalAi({ allowed, target, hostId, hostLabel, insert, focusTerminal, readScreen }: TerminalAiOptions) {
  const chat = useAiChat(target, hostId, hostLabel);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ChatQuote[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; excerpt: TerminalExcerpt } | null>(null);

  const show = () => {
    setOpen(true);
    void chat.resume();
  };

  const quote = (excerpt: TerminalExcerpt | null) => {
    if (excerpt) setPending((list) => (list.some((q) => q.label === lineLabel(excerpt)) ? list : [...list, toQuote(excerpt)]));
    show();
  };

  /** The AI shortcut: opens the panel, quoting the selection if there is one. */
  const onAskAi = allowed ? (excerpt: TerminalExcerpt | null) => quote(excerpt) : undefined;

  const onContextMenu = (event: MouseEvent, excerpt: TerminalExcerpt | null) => {
    if (!allowed || !excerpt) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, excerpt });
  };

  let panel: ReactNode = null;
  if (allowed && open)
    panel = (
      <AiPanel
        chat={chat}
        pending={pending}
        onRemovePending={(i) => setPending((list) => list.filter((_, index) => index !== i))}
        onSent={() => setPending([])}
        readScreen={() => {
          const screen = readScreen();
          return screen ? { label: `Screen ${lineLabel(screen)}`, text: screen.text } : null;
        }}
        onInsert={(command) => {
          insert(command);
          focusTerminal();
        }}
        onClose={() => {
          setOpen(false);
          focusTerminal();
        }}
      />
    );

  const contextMenu = menu && (
    <SelectionMenu
      x={menu.x}
      y={menu.y}
      onAsk={() => {
        quote(menu.excerpt);
        setMenu(null);
      }}
      onCopy={() => {
        void navigator.clipboard?.writeText(menu.excerpt.text);
        setMenu(null);
      }}
      onClose={() => setMenu(null)}
    />
  );

  return { onAskAi, openPanel: show, onContextMenu, panel, contextMenu };
}

import { useState, type MouseEvent, type ReactNode } from "react";

import type { AiTarget } from "@/bindings";

import { AiCommandBar } from "./ai-command-bar";
import { AiExplainPanel } from "./ai-explain-panel";
import { SelectionMenu } from "./selection-menu";

type Mode = { kind: "command" } | { kind: "explain"; selection: string } | null;

interface TerminalAiOptions {
  allowed: boolean;
  target: AiTarget;
  hostId: string | null;
  /** Types text on the prompt line; never adds Enter. */
  insert: (text: string) => void;
  focusTerminal: () => void;
}

/** The AI entry points of a terminal tab: ⌘I bar, "Ask AI" panel, and the selection menu. */
export function useTerminalAi({ allowed, target, hostId, insert, focusTerminal }: TerminalAiOptions) {
  const [mode, setMode] = useState<Mode>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; selection: string } | null>(null);
  const close = () => {
    setMode(null);
    focusTerminal();
  };

  const onAskAi = allowed ? (selection: string) => setMode(selection.trim() ? { kind: "explain", selection } : { kind: "command" }) : undefined;

  const onContextMenu = (event: MouseEvent, selection: string) => {
    if (!allowed || !selection.trim()) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, selection });
  };

  let commandBar: ReactNode = null;
  let explainPanel: ReactNode = null;
  if (allowed && mode?.kind === "command") commandBar = <AiCommandBar target={target} hostId={hostId} onInsert={insert} onClose={close} />;
  if (allowed && mode?.kind === "explain")
    explainPanel = <AiExplainPanel key={mode.selection} target={target} hostId={hostId} selection={mode.selection} onInsert={insert} onClose={close} />;

  const contextMenu = menu && (
    <SelectionMenu
      x={menu.x}
      y={menu.y}
      onAsk={() => {
        setMode({ kind: "explain", selection: menu.selection });
        setMenu(null);
      }}
      onCopy={() => {
        void navigator.clipboard?.writeText(menu.selection);
        setMenu(null);
      }}
      onClose={() => setMenu(null)}
    />
  );

  return { onAskAi, openCommandBar: () => setMode({ kind: "command" }), onContextMenu, commandBar, explainPanel, contextMenu };
}

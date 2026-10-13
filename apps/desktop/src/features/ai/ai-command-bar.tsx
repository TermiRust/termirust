import { Copy, CornerDownLeft, Sparkles, Square, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import type { AiTarget } from "@/bindings";
import { Button } from "@/components/ui/button";

import { AiPreviewPanel } from "./ai-preview-panel";
import { useAiAsk } from "./use-ai-ask";

interface AiCommandBarProps {
  target: AiTarget;
  hostId: string | null;
  /** Puts the command on the prompt line without pressing Enter. */
  onInsert: (command: string) => void;
  onClose: () => void;
}

/** ⌘I: describe a task, get one command, review it, then insert it. Nothing runs by itself. */
export function AiCommandBar({ target, hostId, onInsert, onClose }: AiCommandBarProps) {
  const [prompt, setPrompt] = useState("");
  const ai = useAiAsk();
  const { state } = ai;
  const busy = state.phase === "preparing" || state.phase === "streaming";

  const submit = () => {
    if (!prompt.trim() || busy) return;
    void ai.ask({ target, hostId, question: { mode: "command", prompt } });
  };
  const close = () => {
    ai.reset();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Ask AI for a command"
      className="absolute inset-x-3 bottom-3 z-20 flex flex-col gap-2 rounded-lg border border-border bg-bg p-2.5 shadow-dialog"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="shrink-0 text-accent" />
        <input
          autoFocus
          aria-label="Describe the command you need"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe what you want to do, e.g. find files over 100 MB here"
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
        />
        {busy ? (
          <Button size="sm" variant="outline" onClick={ai.cancel} aria-label="Stop">
            <Square size={11} /> Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={submit} disabled={!prompt.trim()}>
            Ask
          </Button>
        )}
        <button type="button" aria-label="Close AI" onClick={close} className="rounded p-1 text-fg-muted hover:bg-hover">
          <X size={14} />
        </button>
      </div>

      {state.phase === "preparing" && <p className="text-xs text-fg-muted">Preparing…</p>}
      {state.phase === "previewing" && <AiPreviewPanel preview={state.preview} onSend={ai.confirmPreview} onCancel={ai.reset} />}
      {state.phase === "streaming" && (
        <pre aria-label="Answer so far" className="font-mono text-[12px] whitespace-pre-wrap text-fg-2">
          {state.text || "Thinking…"}
        </pre>
      )}
      {state.phase === "done" &&
        (state.command ? (
          <div className="flex flex-col gap-2">
            <code aria-label="Suggested command" className="block rounded border border-border bg-bg-sunk px-2 py-1.5 font-mono text-[12px] break-all">
              {state.command}
            </code>
            {state.danger && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
                <TriangleAlert size={13} /> Careful: this {state.danger}. Read it before running.
              </p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fg-muted">Inserted commands are not run until you press Enter.</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(state.command ?? "")}>
                  <Copy size={12} /> Copy
                </Button>
                <Button
                  size="sm"
                  variant={state.danger ? "danger" : "primary"}
                  autoFocus
                  onClick={() => {
                    onInsert(state.command ?? "");
                    close();
                  }}
                >
                  <CornerDownLeft size={12} /> Insert
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-fg-2">{state.reply.replace(/^#\s*/, "") || "No command came back. Try rephrasing."}</p>
        ))}
      {state.phase === "failed" && (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      )}
      {state.phase === "cancelled" && <p className="text-xs text-fg-muted">Stopped.</p>}
    </div>
  );
}

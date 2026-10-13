import { CornerDownLeft, Sparkles, Square, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import type { AiTarget, SuggestedCommand } from "@/bindings";
import { Button } from "@/components/ui/button";

import { AiPreviewPanel } from "./ai-preview-panel";
import { splitReply } from "./reply-parts";
import { useAiAsk } from "./use-ai-ask";

interface AiExplainPanelProps {
  target: AiTarget;
  hostId: string | null;
  selection: string;
  onInsert: (command: string) => void;
  onClose: () => void;
}

const QUOTE_LINES = 8;

/** "Ask AI" about selected output: an optional question, a streamed answer, insertable commands. */
export function AiExplainPanel({ target, hostId, selection, onInsert, onClose }: AiExplainPanelProps) {
  const [question, setQuestion] = useState("");
  const ai = useAiAsk();
  const { state } = ai;
  const busy = state.phase === "preparing" || state.phase === "streaming";
  const lines = selection.trimEnd().split("\n");
  const reply = state.phase === "streaming" ? state.text : state.phase === "done" ? state.reply : "";
  const suggestions: SuggestedCommand[] = state.phase === "done" ? state.commands : [];

  const submit = () => {
    if (busy) return;
    void ai.ask({ target, hostId, question: { mode: "explain", selection, question } });
  };
  const close = () => {
    ai.reset();
    onClose();
  };

  return (
    <aside
      aria-label="Ask AI about the selection"
      className="motion-slide-right flex w-[360px] shrink-0 flex-col border-l border-border bg-bg"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Sparkles size={14} className="text-accent" />
        <span className="text-[13px] font-medium">Ask AI</span>
        <button type="button" aria-label="Close AI panel" onClick={close} className="ml-auto rounded p-1 text-fg-muted hover:bg-hover">
          <X size={14} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <pre aria-label="Selected output" className="max-h-40 overflow-hidden rounded border border-border bg-bg-sunk p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-muted">
          {lines.slice(0, QUOTE_LINES).join("\n")}
          {lines.length > QUOTE_LINES && `\n… ${lines.length - QUOTE_LINES} more lines`}
        </pre>
        <div className="flex gap-2">
          <input
            autoFocus
            aria-label="Question about the selection"
            value={question}
            placeholder="What does this mean? (optional)"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-bg-elev px-2 text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:border-accent"
          />
          {busy ? (
            <Button size="sm" variant="outline" onClick={ai.cancel}>
              <Square size={11} /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={submit}>
              Ask
            </Button>
          )}
        </div>

        {state.phase === "preparing" && <p className="text-xs text-fg-muted">Preparing…</p>}
        {state.phase === "previewing" && <AiPreviewPanel preview={state.preview} onSend={ai.confirmPreview} onCancel={ai.reset} />}
        {state.phase === "streaming" && !reply && <p className="text-xs text-fg-muted">Thinking…</p>}
        {reply && (
          <div aria-label="Answer" aria-busy={state.phase === "streaming"} className="flex flex-col gap-2 text-[13px] leading-relaxed">
            {splitReply(reply).map((part, index) =>
              part.kind === "text" ? (
                <p key={index} className="whitespace-pre-wrap">
                  {part.text}
                </p>
              ) : (
                <CodeBlock
                  key={index}
                  code={part.code}
                  suggestion={part.shell ? suggestions.find((s) => s.command === part.code) : undefined}
                  onInsert={(command) => {
                    onInsert(command);
                    close();
                  }}
                />
              ),
            )}
          </div>
        )}
        {state.phase === "failed" && (
          <p role="alert" className="text-xs text-danger">
            {state.message}
          </p>
        )}
        {state.phase === "cancelled" && <p className="text-xs text-fg-muted">Stopped.</p>}
      </div>
    </aside>
  );
}

function CodeBlock({ code, suggestion, onInsert }: { code: string; suggestion: SuggestedCommand | undefined; onInsert: (command: string) => void }) {
  return (
    <div className="rounded border border-border bg-bg-sunk">
      <pre className="overflow-x-auto p-2 font-mono text-[12px]">{code}</pre>
      {suggestion && (
        <div className="flex items-center gap-2 border-t border-border px-2 py-1">
          {suggestion.danger && (
            <span role="alert" className="flex items-center gap-1 text-[11px] text-danger">
              <TriangleAlert size={12} /> This {suggestion.danger}.
            </span>
          )}
          <Button
            size="sm"
            variant={suggestion.danger ? "danger" : "outline"}
            className="ml-auto h-6"
            aria-label={`Insert into terminal: ${code}`}
            onClick={() => onInsert(suggestion.command)}
          >
            <CornerDownLeft size={11} /> Insert into terminal
          </Button>
        </div>
      )}
    </div>
  );
}

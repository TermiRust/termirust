import { RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { AiPreviewPanel } from "./ai-preview-panel";
import { MarkdownReply } from "./markdown-reply";
import { QuoteChip } from "./quote-chip";
import type { ChatQuote, useAiChat } from "./use-ai-chat";

interface AiPanelProps {
  chat: ReturnType<typeof useAiChat>;
  /** Quotes picked in the terminal, waiting to go with the next question. */
  pending: ChatQuote[];
  onRemovePending: (index: number) => void;
  onSent: () => void;
  /** Reads the visible terminal screen when "Include terminal screen" is on. */
  readScreen: () => ChatQuote | null;
  onInsert: (command: string) => void;
  onClose: () => void;
}

/** The AI side panel: one conversation per terminal, quotes with line labels, Markdown answers. */
export function AiPanel({ chat, pending, onRemovePending, onSent, readScreen, onInsert, onClose }: AiPanelProps) {
  const [message, setMessage] = useState("");
  const [withScreen, setWithScreen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastText = chat.entries.at(-1)?.text;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [chat.entries.length, lastText, chat.preview]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [pending.length]);

  const canSend = !chat.busy && (message.trim().length > 0 || pending.length > 0 || withScreen);
  const submit = () => {
    if (!canSend) return;
    void chat.ask({ message: message.trim(), quotes: pending, screen: withScreen ? readScreen() : null });
    setMessage("");
    onSent();
  };

  return (
    <aside
      aria-label="AI assistant"
      className="motion-slide-right flex w-[380px] shrink-0 flex-col border-l border-border bg-bg"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3">
        <Sparkles size={14} className="text-accent" />
        <span className="text-[13px] font-medium">AI</span>
        <Button size="icon" className="ml-auto" aria-label="New conversation" title="New conversation" onClick={chat.clear} disabled={chat.entries.length === 0}>
          <RotateCcw size={13} />
        </Button>
        <Button size="icon" aria-label="Close AI panel" onClick={onClose}>
          <X size={14} />
        </Button>
      </header>

      <div aria-label="Conversation" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {chat.entries.length === 0 && !chat.preview && (
          <p className="text-[13px] text-fg-muted">
            Ask anything about this terminal. Select output and press the AI shortcut (or right-click → Ask AI) to quote it; commands in answers can be inserted, never run for you.
          </p>
        )}
        {chat.entries.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.id} className="ml-6 flex flex-col items-end gap-1">
              {entry.text && <div className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-[13px] whitespace-pre-wrap">{entry.text}</div>}
              {entry.quotes.map((q) => (
                <QuoteChip key={q.label} quote={q} />
              ))}
            </div>
          ) : (
            <div key={entry.id} aria-label="Answer" aria-busy={entry.status === "streaming"}>
              {entry.text ? <MarkdownReply text={entry.text} commands={entry.commands} onInsert={onInsert} /> : entry.status === "streaming" && <p className="text-xs text-fg-muted">Thinking…</p>}
              {entry.status === "failed" && (
                <p role="alert" className="text-xs text-danger">
                  {entry.error}
                </p>
              )}
              {entry.status === "cancelled" && <p className="text-xs text-fg-muted">Stopped.</p>}
            </div>
          ),
        )}
        {chat.preparing && <p className="text-xs text-fg-muted">Preparing…</p>}
        {chat.preview && <AiPreviewPanel preview={chat.preview} onSend={chat.confirmPreview} onCancel={chat.dismissPreview} />}
        <div ref={endRef} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border p-2.5">
        {pending.length > 0 && (
          <div aria-label="Attached" className="flex flex-col gap-1">
            {pending.map((q, i) => (
              <QuoteChip key={`${q.label}-${i}`} quote={q} onRemove={() => onRemovePending(i)} />
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          aria-label="Ask the AI"
          rows={2}
          value={message}
          placeholder={pending.length > 0 ? "Ask about the quoted output (optional)…" : "Ask, or describe a command you need…"}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 min-h-[52px] resize-none rounded-md border border-border-strong bg-bg-elev px-2.5 py-1.5 text-[13px] text-fg outline-none placeholder:text-fg-faint focus-visible:border-accent"
        />
        <div className="flex items-center gap-2">
          <Checkbox label="Include terminal screen" checked={withScreen} onChange={(e) => setWithScreen(e.target.checked)} className="text-xs" />
          {chat.busy ? (
            <Button size="sm" variant="outline" className="ml-auto" onClick={chat.cancel}>
              <Square size={11} /> Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" className="ml-auto" onClick={submit} disabled={!canSend}>
              Send
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

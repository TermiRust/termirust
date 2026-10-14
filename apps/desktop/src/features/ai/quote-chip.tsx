import { ChevronDown, ChevronRight, FileText, X } from "lucide-react";
import { useState } from "react";

import type { ChatQuote } from "./use-ai-chat";

/** "L35–L55" attachment: click to read what was quoted, × to drop it before sending. */
export function QuoteChip({ quote, onRemove }: { quote: ChatQuote; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-full">
      <span className="inline-flex max-w-full items-center rounded-md border border-border-strong bg-bg-elev text-[11px]">
        <button type="button" aria-expanded={open} aria-label={`Quoted ${quote.label}`} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 px-1.5 py-0.5 font-mono text-fg-2 hover:text-fg">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <FileText size={11} />
          {quote.label}
        </button>
        {onRemove && (
          <button type="button" aria-label={`Remove ${quote.label}`} onClick={onRemove} className="border-l border-border px-1 py-0.5 text-fg-muted hover:text-fg">
            <X size={11} />
          </button>
        )}
      </span>
      {open && <pre className="mt-1 max-h-40 overflow-auto rounded border border-border bg-bg-sunk p-1.5 font-mono text-[11px] whitespace-pre-wrap text-fg-muted">{quote.text}</pre>}
    </div>
  );
}

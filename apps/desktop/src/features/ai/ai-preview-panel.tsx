import { ShieldCheck } from "lucide-react";

import type { AiPreview } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAiStore } from "@/stores/ai-store";

interface AiPreviewPanelProps {
  preview: AiPreview;
  onSend: () => void;
  onCancel: () => void;
}

/** Shows exactly what will leave the machine before it does. */
export function AiPreviewPanel({ preview, onSend, onCancel }: AiPreviewPanelProps) {
  const alwaysPreview = useAiStore((s) => s.alwaysPreview);
  const setAlwaysPreview = useAiStore((s) => s.setAlwaysPreview);
  return (
    <section aria-label="What will be sent" className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <ShieldCheck size={13} className="text-ok" />
        Sent to {preview.provider}.{" "}
        {preview.masked > 0 ? `${preview.masked} secret${preview.masked === 1 ? " was" : "s were"} masked.` : "Nothing looked like a secret."} No hostname, IP or username is
        included.
      </p>
      <pre aria-label="Instructions sent" className="max-h-24 overflow-auto rounded border border-border bg-bg-sunk p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-muted">
        {preview.system}
      </pre>
      <pre aria-label="Your text as sent" className="max-h-40 overflow-auto rounded border border-border bg-bg-sunk p-2 font-mono text-[11px] whitespace-pre-wrap">
        {preview.user}
      </pre>
      <div className="flex items-center gap-2">
        <Checkbox label="Always show this before sending" checked={alwaysPreview} onChange={(e) => setAlwaysPreview(e.target.checked)} />
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={onSend} autoFocus>
            Send
          </Button>
        </div>
      </div>
    </section>
  );
}

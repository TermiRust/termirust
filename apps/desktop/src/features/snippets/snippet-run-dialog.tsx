import { CornerDownLeft, Play, SquareCode } from "lucide-react";

import type { SnippetView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

import { canInsert, snippetKeystrokes } from "./keystrokes";
import { SnippetFields } from "./snippet-fields";
import { useSnippetCommand } from "./use-snippet-command";

interface SnippetRunDialogProps {
  snippet: SnippetView;
  /** Where it will be typed, e.g. the tab title. */
  targetLabel: string;
  onSend: (keystrokes: string) => void;
  onClose: () => void;
}

/** Fill in variables, see the final command, then insert it or run it. */
export function SnippetRunDialog({ snippet, targetLabel, onSend, onClose }: SnippetRunDialogProps) {
  const form = useSnippetCommand(snippet);
  const send = (run: boolean) => {
    onSend(snippetKeystrokes(form.command, run));
    onClose();
  };

  return (
    <Dialog open width="md" title={`Run ${snippet.name}`} description={`In ${targetLabel}`} icon={<SquareCode size={15} />} onOpenChange={(open) => !open && onClose()}>
      <form
        aria-label="Run snippet"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canInsert(form.command)) send(false);
        }}
      >
        <SnippetFields form={form} />
        <DialogFooter className="justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {canInsert(form.command) ? (
            <Button type="submit" variant="outline">
              <CornerDownLeft size={13} /> Insert
            </Button>
          ) : (
            <span className="text-[11px] text-fg-muted">Multi-line snippets run line by line.</span>
          )}
          <Button variant={form.reason ? "danger" : "primary"} disabled={form.blocked} onClick={() => send(true)} autoFocus={form.variables.length === 0}>
            <Play size={13} /> Run
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

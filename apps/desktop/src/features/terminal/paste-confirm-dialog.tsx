import { ClipboardPaste } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

import { pastedLineCount } from "./paste-guard";

interface PasteConfirmDialogProps {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PasteConfirmDialog({ text, onConfirm, onCancel }: PasteConfirmDialogProps) {
  const lines = pastedLineCount(text);
  return (
    <Dialog
      open
      width="md"
      onOpenChange={(open) => !open && onCancel()}
      title={`Paste ${lines} lines?`}
      description="Each line may run as a separate command."
      icon={<ClipboardPaste size={15} />}
    >
      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-bg-sunk p-2 font-mono text-xs whitespace-pre-wrap select-text">{text}</pre>
      <DialogFooter className="justify-end">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} autoFocus>
          Paste
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

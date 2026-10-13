import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

interface ConfirmCloseDialogProps {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmCloseDialog({ title, onConfirm, onCancel }: ConfirmCloseDialogProps) {
  return (
    <Dialog
      open
      width="sm"
      onOpenChange={(open) => !open && onCancel()}
      title={`Close ${title}?`}
      description="The SSH session is still connected. Closing the tab disconnects it."
    >
      <DialogFooter className="justify-end">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} autoFocus>
          Close tab
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

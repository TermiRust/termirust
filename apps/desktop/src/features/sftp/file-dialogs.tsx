import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { validFileName } from "./paths";

interface NameDialogProps {
  title: string;
  initial: string;
  action: string;
  onSubmit: (name: string) => Promise<string | null>;
  onClose: () => void;
}

/** Asks for a file or folder name; `onSubmit` resolves to an error message or null. */
export function NameDialog({ title, initial, action, onSubmit, onClose }: NameDialogProps) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = validFileName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    const failure = await onSubmit(name.trim());
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <Dialog open width="sm" title={title} onOpenChange={(open) => !open && onClose()}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="Name" error={error ?? undefined}>
          <Input aria-label="Name" value={name} autoFocus spellCheck={false} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} />
        </Field>
        <DialogFooter className="justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {action}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

interface ConfirmDialogProps {
  title: string;
  description: string;
  items: string[];
  action: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, description, items, action, danger, onConfirm, onClose }: ConfirmDialogProps) {
  const shown = items.slice(0, 8);
  return (
    <Dialog open width="sm" title={title} description={description} tone={danger ? "danger" : "default"} onOpenChange={(open) => !open && onClose()}>
      <ul className="flex flex-col gap-0.5 font-mono text-xs text-fg-2">
        {shown.map((item) => (
          <li key={item} className="truncate">
            {item}
          </li>
        ))}
        {items.length > shown.length && <li className="text-fg-muted">…and {items.length - shown.length} more</li>}
      </ul>
      <DialogFooter className="justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          autoFocus
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {action}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

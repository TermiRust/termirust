import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useHostsStore } from "@/stores/hosts-store";

interface GroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GroupFormDialog({ open, onOpenChange }: GroupFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New group">
      <GroupForm onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function GroupForm({ onClose }: { onClose: () => void }) {
  const createGroup = useHostsStore((s) => s.createGroup);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Group name is required");
      return;
    }
    const result = await createGroup(name.trim());
    if (result.status === "error") setError(result.error.message);
    else onClose();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Name" error={error ?? undefined}>
        <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" autoFocus />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Create
        </Button>
      </div>
    </form>
  );
}

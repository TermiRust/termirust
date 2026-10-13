import { FolderPen, FolderPlus } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { GroupView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorSwatches } from "@/components/ui/color-swatches";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { TabColor } from "@/features/tabs/tab-color";
import { useHostsStore } from "@/stores/hosts-store";

interface GroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing group. */
  group?: GroupView;
}

export function GroupFormDialog({ open, onOpenChange, group }: GroupFormDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={group ? `Edit ${group.name}` : "New group"}
      icon={group ? <FolderPen size={15} /> : <FolderPlus size={15} />}
      width="sm"
    >
      <GroupForm group={group} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function GroupForm({ group, onClose }: { group?: GroupView; onClose: () => void }) {
  const { createGroup, updateGroup, deleteGroup } = useHostsStore();
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<TabColor | null>((group?.color as TabColor | null | undefined) ?? null);
  const [warningBorder, setWarningBorder] = useState(group?.warningBorder ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Group name is required");
      return;
    }
    const result = group ? await updateGroup(group.id, name.trim(), color, warningBorder) : await createGroup(name.trim());
    if (result.status === "error") setError(result.error.message);
    else onClose();
  };

  const remove = async () => {
    if (!group) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const result = await deleteGroup(group.id);
    if (result.status === "error") setError(result.error.message);
    else onClose();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Name" error={error ?? undefined}>
        <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production" autoFocus />
      </Field>
      {group && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-2">Tab colour</span>
            <ColorSwatches label="Group colour" value={color} onChange={setColor} autoLabel="From name" />
          </div>
          <Checkbox
            label="Warning border around terminals"
            description="A coloured frame on every tab of this group, as a reminder you are on a sensitive server."
            checked={warningBorder}
            onChange={(e) => setWarningBorder(e.target.checked)}
          />
        </>
      )}
      <DialogFooter>
        {group && (
          <Button variant={confirmDelete ? "danger" : "ghost"} onClick={() => void remove()}>
            {confirmDelete ? "Click again to delete" : "Delete group"}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {group ? "Save" : "Create"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

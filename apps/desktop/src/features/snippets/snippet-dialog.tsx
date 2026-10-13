import { SquareCode } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { SnippetView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSnippetsStore } from "@/stores/snippets-store";

import { parseVariables } from "./variables";

interface SnippetDialogProps {
  snippet?: SnippetView;
  onClose: () => void;
}

/** Mounted only while open, so its fields start from `snippet`. */
export function SnippetDialog({ snippet, onClose }: SnippetDialogProps) {
  const { create, update } = useSnippetsStore.getState();
  const [name, setName] = useState(snippet?.name ?? "");
  const [command, setCommand] = useState(snippet?.command ?? "");
  const [description, setDescription] = useState(snippet?.description ?? "");
  const [tags, setTags] = useState(snippet?.tags.join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const variables = parseVariables(command);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!command.trim()) {
      setError("Enter the command to save");
      return;
    }
    setSaving(true);
    const input = { name, command, description, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) };
    const result = snippet ? await update(snippet.id, input) : await create(input);
    setSaving(false);
    if (result.status === "error") setError(result.error.message);
    else onClose();
  };

  return (
    <Dialog open width="lg" title={snippet ? `Edit ${snippet.name}` : "New snippet"} icon={<SquareCode size={15} />} onOpenChange={(open) => !open && onClose()}>
      <form aria-label="Snippet" onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="Name" hint="Defaults to the first line of the command">
          <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Follow nginx logs" autoFocus />
        </Field>
        <Field label="Command" hint="Use {{name}} or {{name:default}} for values you fill in when running it.">
          <textarea
            aria-label="Command"
            value={command}
            spellCheck={false}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="journalctl -u {{service:nginx}} -n {{lines:200}} -f"
            className="min-h-24 resize-y rounded-md border border-border-strong bg-bg-elev px-2.5 py-1.5 font-mono text-[12px] text-fg"
          />
        </Field>
        {variables.length > 0 && (
          <div aria-label="Variables" className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
            Variables:
            {variables.map((v) => (
              <span key={v.name} className="rounded border border-border bg-bg-sunk px-1.5 py-0.5 font-mono text-fg-2">
                {v.name}
                {v.defaultValue && <span className="text-fg-muted"> = {v.defaultValue}</span>}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Description">
            <Input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <Input aria-label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="logs, nginx" />
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <DialogFooter className="justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

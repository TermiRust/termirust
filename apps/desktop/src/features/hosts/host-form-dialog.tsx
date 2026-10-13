import { useState, type FormEvent } from "react";

import type { CommandError, HostInput, HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, selectClass } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useHostsStore } from "@/stores/hosts-store";

import { hostFormValues, hostInputFromForm, type HostFormErrors, type HostFormValues } from "./host-form";

type SaveResult = { status: "ok" } | { status: "error"; error: CommandError };

interface HostFormDialogProps {
  open: boolean;
  host?: HostView;
  onOpenChange: (open: boolean) => void;
  onSave: (input: HostInput) => Promise<SaveResult>;
  onDelete?: () => Promise<SaveResult>;
}

export function HostFormDialog({ open, host, onOpenChange, onSave, onDelete }: HostFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={host ? `Edit ${host.label}` : "New host"}>
      <HostForm host={host} onClose={() => onOpenChange(false)} onSave={onSave} onDelete={onDelete} />
    </Dialog>
  );
}

interface HostFormProps {
  host?: HostView;
  onClose: () => void;
  onSave: (input: HostInput) => Promise<SaveResult>;
  onDelete?: () => Promise<SaveResult>;
}

/** Mounted fresh each time the dialog opens, so its state starts from `host`. */
function HostForm({ host, onClose, onSave, onDelete }: HostFormProps) {
  const groups = useHostsStore((s) => s.groups);
  const hosts = useHostsStore((s) => s.hosts);
  const [values, setValues] = useState<HostFormValues>(() => hostFormValues(host));
  const [errors, setErrors] = useState<HostFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasSavedPassword = host?.auth.method === "password" && host.auth.hasSavedPassword;

  const set = <K extends keyof HostFormValues>(key: K, value: HostFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const text = (key: keyof HostFormValues) => ({
    "aria-label": fieldLabels[key],
    value: values[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as never),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = hostInputFromForm(values, hasSavedPassword);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await onSave(parsed.input);
    setSaving(false);
    if (result.status === "error") setServerError(result.error.message);
    else onClose();
  };

  const remove = async () => {
    if (!onDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const result = await onDelete();
    if (result.status === "error") setServerError(result.error.message);
    else onClose();
  };

  const jumpCandidates = hosts.filter((h) => h.id !== host?.id);

  return (
    <form onSubmit={submit} className="grid grid-cols-6 gap-3" aria-label="Host">
        <Field label={fieldLabels.label} className="col-span-6" hint="Defaults to the host address">
          <Input {...text("label")} placeholder="prod-api-1" />
        </Field>
        <Field label={fieldLabels.hostname} error={errors.hostname} className="col-span-4">
          <Input {...text("hostname")} placeholder="10.0.1.12 or server.example.com" />
        </Field>
        <Field label={fieldLabels.port} error={errors.port} className="col-span-2">
          <Input {...text("port")} inputMode="numeric" />
        </Field>
        <Field label={fieldLabels.username} className="col-span-3">
          <Input {...text("username")} placeholder="root" />
        </Field>
        <Field label={fieldLabels.authMethod} className="col-span-3">
          <select
            aria-label={fieldLabels.authMethod}
            className={selectClass}
            value={values.authMethod}
            onChange={(e) => set("authMethod", e.target.value as HostFormValues["authMethod"])}
          >
            <option value="password">Password</option>
            <option value="agent">SSH agent</option>
          </select>
        </Field>

        {values.authMethod === "password" && hasSavedPassword && (
          <Field label={fieldLabels.savedPasswordAction} className="col-span-6">
            <select
              aria-label={fieldLabels.savedPasswordAction}
              className={selectClass}
              value={values.savedPasswordAction}
              onChange={(e) => set("savedPasswordAction", e.target.value as HostFormValues["savedPasswordAction"])}
            >
              <option value="keep">Keep the saved password</option>
              <option value="replace">Replace it</option>
              <option value="clear">Forget it (ask when connecting)</option>
            </select>
          </Field>
        )}
        {values.authMethod === "password" && (!hasSavedPassword || values.savedPasswordAction === "replace") && (
          <Field
            label={fieldLabels.password}
            error={errors.password}
            className="col-span-6"
            hint="Stored encrypted. Leave empty to be asked when connecting."
          >
            <Input {...text("password")} type="password" autoComplete="new-password" />
          </Field>
        )}

        <Field label={fieldLabels.groupId} className="col-span-3">
          <select aria-label={fieldLabels.groupId} className={selectClass} value={values.groupId} onChange={(e) => set("groupId", e.target.value)}>
            <option value="">Ungrouped</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.parentId ? `  ${g.name}` : g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={fieldLabels.jumpHostId} className="col-span-3">
          <select aria-label={fieldLabels.jumpHostId} className={selectClass} value={values.jumpHostId} onChange={(e) => set("jumpHostId", e.target.value)}>
            <option value="">None</option>
            {jumpCandidates.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={fieldLabels.tags} className="col-span-4" hint="Comma separated">
          <Input {...text("tags")} placeholder="prod, api" />
        </Field>
        <Field label={fieldLabels.keepaliveSecs} error={errors.keepaliveSecs} className="col-span-2">
          <Input {...text("keepaliveSecs")} inputMode="numeric" placeholder="30" />
        </Field>
        <Field label={fieldLabels.notes} className="col-span-6">
          <textarea
            aria-label={fieldLabels.notes}
            className="min-h-16 rounded-md border border-border bg-bg-elev px-2.5 py-1.5 text-sm text-fg"
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>

        {serverError && (
          <p role="alert" className="col-span-6 text-sm text-accent">
            {serverError}
          </p>
        )}

        <div className="col-span-6 mt-1 flex items-center gap-2">
          {onDelete && (
            <Button type="button" variant="outline" onClick={() => void remove()}>
              {confirmDelete ? "Click again to delete" : "Delete"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
    </form>
  );
}

const fieldLabels: Record<keyof HostFormValues, string> = {
  label: "Label",
  hostname: "Host",
  port: "Port",
  username: "Username",
  authMethod: "Authentication",
  password: "Password",
  savedPasswordAction: "Saved password",
  groupId: "Group",
  jumpHostId: "Jump host",
  tags: "Tags",
  notes: "Notes",
  keepaliveSecs: "Keepalive (s)",
};

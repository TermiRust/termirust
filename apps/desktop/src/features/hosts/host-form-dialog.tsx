import { ChevronRight, KeyRound, Lock, Plus, Server, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { CommandError, HostInput, HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ColorSwatches } from "@/components/ui/color-swatches";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { ImportKeyDialog } from "@/features/keychain/import-key-dialog";
import { useHostsStore } from "@/stores/hosts-store";
import { useKeysStore } from "@/stores/keys-store";

import { hostFormValues, hostInputFromForm, type HostFormErrors, type HostFormValues } from "./host-form";
import { PROXY_PRESETS, fillRange, type ProxyPreset } from "./proxy-presets";

type SaveResult = { status: "ok"; data: HostView } | { status: "error"; error: CommandError };
type DeleteResult = { status: "ok"; data: null } | { status: "error"; error: CommandError };

interface HostFormDialogProps {
  open: boolean;
  host?: HostView;
  onOpenChange: (open: boolean) => void;
  onSave: (input: HostInput) => Promise<SaveResult>;
  onDelete?: () => Promise<DeleteResult>;
  /** Called with the saved host when the user chose "Save & Connect". */
  onConnect?: (host: HostView) => void;
}

export function HostFormDialog({ open, host, onOpenChange, onSave, onDelete, onConnect }: HostFormDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={host ? `Edit ${host.label}` : "New host"}
      icon={<Server size={15} />}
      width="lg"
    >
      <HostForm host={host} onClose={() => onOpenChange(false)} onSave={onSave} onDelete={onDelete} onConnect={onConnect} />
    </Dialog>
  );
}

interface HostFormProps {
  host?: HostView;
  onClose: () => void;
  onSave: (input: HostInput) => Promise<SaveResult>;
  onDelete?: () => Promise<DeleteResult>;
  onConnect?: (host: HostView) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid grid-cols-6 gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <legend className="col-span-6 mb-1 float-left text-[11px] font-semibold tracking-wider text-fg-muted uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Mounted fresh each time the dialog opens, so its state starts from `host`. */
function HostForm({ host, onClose, onSave, onDelete, onConnect }: HostFormProps) {
  const groups = useHostsStore((s) => s.groups);
  const hosts = useHostsStore((s) => s.hosts);
  const { keys, loaded: keysLoaded, load: loadKeys } = useKeysStore();
  const [values, setValues] = useState<HostFormValues>(() => hostFormValues(host));
  const [errors, setErrors] = useState<HostFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importingKey, setImportingKey] = useState(false);
  const hasSavedPassword = host?.auth.method === "password" && host.auth.hasSavedPassword;

  useEffect(() => {
    if (!keysLoaded) void loadKeys();
  }, [keysLoaded, loadKeys]);

  const set = <K extends keyof HostFormValues>(key: K, value: HostFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const proxyRef = useRef<HTMLInputElement>(null);
  /** Fills a template and selects the part still to replace (e.g. ZONE), ready to type over. */
  const applyPreset = (preset: ProxyPreset) => {
    set("proxyCommand", preset.command);
    const range = fillRange(preset);
    requestAnimationFrame(() => {
      const input = proxyRef.current;
      if (!input) return;
      input.focus();
      if (range) input.setSelectionRange(range[0], range[1]);
    });
  };
  const text = (key: TextField) => ({
    "aria-label": fieldLabels[key],
    "aria-invalid": errors[key] ? true : undefined,
    value: values[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as never),
  });

  const save = async (connect: boolean) => {
    const parsed = hostInputFromForm(values, hasSavedPassword);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await onSave(parsed.input);
    setSaving(false);
    if (result.status === "error") {
      setServerError(result.error.message);
      return;
    }
    onClose();
    if (connect) onConnect?.(result.data);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(Boolean(onConnect));
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
    <form onSubmit={submit} aria-label="Host" className="flex flex-col gap-4">
      <Section title="Address">
        <Field label={fieldLabels.label} className="col-span-6" hint="Defaults to the host address">
          <Input {...text("label")} placeholder="prod-api-1" />
        </Field>
        <Field label={fieldLabels.hostname} error={errors.hostname} className="col-span-4">
          <Input {...text("hostname")} placeholder="10.0.1.12 or server.example.com" autoFocus={!host} />
        </Field>
        <Field label={fieldLabels.port} error={errors.port} className="col-span-2">
          <Input {...text("port")} inputMode="numeric" />
        </Field>
        <Field
          label={fieldLabels.username}
          className="col-span-6"
          hint={/[A-Z]/.test(values.username) ? `Usernames are case-sensitive — most servers expect “${values.username.toLowerCase()}”.` : undefined}
        >
          <Input {...text("username")} placeholder="root" />
        </Field>
      </Section>

      <Section title="Authentication">
        <div className="col-span-6">
          <SegmentedControl
            label="Authentication"
            value={values.authMethod}
            onChange={(v) => set("authMethod", v)}
            options={[
              { value: "password", label: <span className="flex items-center gap-1.5"><Lock size={12} />Password</span> },
              { value: "key", label: <span className="flex items-center gap-1.5"><KeyRound size={12} />Key</span> },
              { value: "agent", label: <span className="flex items-center gap-1.5"><UserRound size={12} />Agent</span> },
            ]}
          />
        </div>

        {values.authMethod === "password" && hasSavedPassword && (
          <div className="col-span-6 flex items-center gap-3">
            <span className="text-[13px] text-ok">Password saved</span>
            <SegmentedControl
              label="Saved password"
              value={values.savedPasswordAction}
              onChange={(v) => set("savedPasswordAction", v)}
              options={[
                { value: "keep", label: "Keep" },
                { value: "replace", label: "Replace" },
                { value: "clear", label: "Forget" },
              ]}
            />
          </div>
        )}
        {values.authMethod === "password" && (!hasSavedPassword || values.savedPasswordAction === "replace") && (
          <Field label={fieldLabels.password} error={errors.password} className="col-span-6" hint="Stored encrypted. Leave empty to be asked when connecting.">
            <Input {...text("password")} type="password" autoComplete="new-password" />
          </Field>
        )}

        {values.authMethod === "key" && (
          <div className="col-span-6 flex items-end gap-2">
            <Field label={fieldLabels.keyId} error={errors.keyId} className="flex-1" hint={keys.length === 0 ? "Your Keychain is empty — import a key first." : undefined}>
              <Select aria-label={fieldLabels.keyId} value={values.keyId} onChange={(e) => set("keyId", e.target.value)} aria-invalid={errors.keyId ? true : undefined}>
                <option value="">Choose a key…</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label} · {k.keyType} · {k.fingerprint.slice(0, 18)}…
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="outline" onClick={() => setImportingKey(true)} className={errors.keyId ? "mb-5" : keys.length === 0 ? "mb-5" : ""}>
              <Plus size={14} /> Import key
            </Button>
          </div>
        )}

        {values.authMethod === "agent" && (
          <p className="col-span-6 flex items-start gap-2 rounded-md border border-border bg-bg-sunk p-2.5 text-[13px] text-fg-2">
            <KeyRound size={14} className="mt-0.5 shrink-0 text-fg-muted" />
            Uses the keys offered by your running ssh-agent (OpenSSH, 1Password, Secretive…). Nothing is stored here.
          </p>
        )}
      </Section>

      <Section title="Organisation">
        <Field label={fieldLabels.groupId} className="col-span-3">
          <Select aria-label={fieldLabels.groupId} value={values.groupId} onChange={(e) => set("groupId", e.target.value)}>
            <option value="">Ungrouped</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.parentId ? `  ${g.name}` : g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={fieldLabels.tags} className="col-span-3" hint="Comma separated">
          <Input {...text("tags")} placeholder="prod, api" />
        </Field>
        <div className="col-span-6 flex items-center gap-3">
          <span className="text-xs font-medium text-fg-2">Environment</span>
          <SegmentedControl
            label="Environment"
            value={values.environment}
            onChange={(v) => set("environment", v)}
            options={[
              { value: "none", label: "None" },
              { value: "development", label: "Dev" },
              { value: "staging", label: "Staging" },
              { value: "production", label: <span className="font-semibold text-danger">PROD</span> },
            ]}
          />
          {values.environment === "production" && <span className="text-[11px] text-fg-muted">Terminals show a PROD watermark</span>}
        </div>
        <div className="col-span-6 flex items-center gap-3">
          <span className="text-xs font-medium text-fg-2">Tab colour</span>
          <ColorSwatches label="Tab colour" value={values.color} onChange={(c) => set("color", c)} autoLabel="From group" />
        </div>
      </Section>

      <details className="group border-t border-border pt-3" open={Boolean(errors.keepaliveSecs || errors.proxyCommand) || values.proxyCommand !== ""}>
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold tracking-wider text-fg-muted uppercase select-none">
          <ChevronRight size={13} className="transition-transform group-open:rotate-90" /> Advanced
        </summary>
        <div className="mt-3 grid grid-cols-6 gap-3">
          <Field label={fieldLabels.jumpHostId} className="col-span-4">
            <Select aria-label={fieldLabels.jumpHostId} value={values.jumpHostId} onChange={(e) => set("jumpHostId", e.target.value)}>
              <option value="">None</option>
              {jumpCandidates.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={fieldLabels.keepaliveSecs} error={errors.keepaliveSecs} className="col-span-2">
            <Input {...text("keepaliveSecs")} inputMode="numeric" placeholder="30" />
          </Field>
          <Field
            label={fieldLabels.proxyCommand}
            error={errors.proxyCommand}
            className="col-span-6"
            hint="A local command that carries the connection, as OpenSSH ProxyCommand: %h host, %p port, %r user. E.g. Cloudflare Tunnel."
          >
            <Input
              {...text("proxyCommand")}
              ref={proxyRef}
              spellCheck={false}
              placeholder="cloudflared access ssh --hostname %h"
              className="font-mono text-[12px]"
            />
          </Field>
          <div role="group" aria-label="Proxy command templates" className="col-span-6 -mt-1 flex flex-wrap gap-1.5">
            {PROXY_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                title={preset.command}
                onClick={() => applyPreset(preset)}
                className="rounded-full border border-border bg-bg-elev px-2.5 py-0.5 text-[11.5px] text-fg-2 hover:border-accent hover:text-fg"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Checkbox
            className="col-span-6"
            label="Turn off AI for this host"
            description="Hides AI help in its tabs, e.g. for a production database."
            checked={values.aiDisabled}
            onChange={(e) => set("aiDisabled", e.target.checked)}
          />
          <Field label={fieldLabels.notes} className="col-span-6">
            <textarea
              aria-label={fieldLabels.notes}
              className="min-h-16 resize-y rounded-md border border-border-strong bg-bg-elev px-2.5 py-1.5 text-[13px] text-fg"
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
      </details>

      {serverError && (
        <p role="alert" className="text-[13px] text-danger">
          {serverError}
        </p>
      )}

      <DialogFooter>
        {onDelete && (
          <Button variant={confirmDelete ? "danger" : "ghost"} onClick={() => void remove()}>
            {confirmDelete ? "Click again to delete" : "Delete"}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {onConnect ? (
            <>
              <Button variant="outline" disabled={saving} onClick={() => void save(false)}>
                Save
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : "Save & Connect"}
              </Button>
            </>
          ) : (
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </DialogFooter>

      <ImportKeyDialog
        open={importingKey}
        onOpenChange={setImportingKey}
        onImported={(key) => setValues((v) => ({ ...v, keyId: key.id }))}
      />
    </form>
  );
}

type TextField = { [K in keyof HostFormValues]: HostFormValues[K] extends string ? K : never }[keyof HostFormValues];

const fieldLabels: Record<keyof HostFormValues, string> = {
  label: "Label",
  hostname: "Host",
  port: "Port",
  username: "Username",
  authMethod: "Authentication",
  password: "Password",
  savedPasswordAction: "Saved password",
  keyId: "Key",
  groupId: "Group",
  jumpHostId: "Jump host",
  proxyCommand: "Proxy command",
  tags: "Tags",
  notes: "Notes",
  keepaliveSecs: "Keepalive (s)",
  color: "Tab colour",
  aiDisabled: "Turn off AI",
  environment: "Environment",
};

import { TriangleAlert, Waypoints } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { ForwardRuleView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { useForwardsStore } from "@/stores/forwards-store";
import { useHostsStore } from "@/stores/hosts-store";

import { exposesToNetwork, forwardFormValues, forwardInputFromForm, type ForwardFormErrors, type ForwardFormValues, type ForwardKind } from "./forward-form";

interface ForwardRuleDialogProps {
  rule?: ForwardRuleView;
  onClose: () => void;
}

const copy: Record<ForwardKind, { listen: string; destination: string; explain: string }> = {
  local: {
    listen: "Listen on this machine",
    destination: "Destination, as seen from the server",
    explain: "Connections to the local port are carried to the destination by the server (ssh -L).",
  },
  remote: {
    listen: "Listen on the server",
    destination: "Destination on this machine",
    explain: "Connections to the server's port are carried back to a service here (ssh -R). Port 0 lets the server choose.",
  },
  dynamic: {
    listen: "SOCKS5 proxy on this machine",
    destination: "",
    explain: "Point a browser or curl --socks5-hostname at this port; traffic leaves from the server (ssh -D).",
  },
};

/** Mounted only while open, so its state always starts from `rule`. */
export function ForwardRuleDialog({ rule, onClose }: ForwardRuleDialogProps) {
  const hosts = useHostsStore((s) => s.hosts);
  const { create, update } = useForwardsStore.getState();
  const [values, setValues] = useState<ForwardFormValues>(() => forwardFormValues(rule, hosts[0]?.id ?? ""));
  const [errors, setErrors] = useState<ForwardFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ForwardFormValues>(key: K, value: ForwardFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const text = textProps(values, errors, set);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = forwardInputFromForm(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    const result = rule ? await update(rule.id, parsed.input) : await create(parsed.input);
    setSaving(false);
    if (result.status === "error") setServerError(result.error.message);
    else onClose();
  };

  const labels = copy[values.kind];
  return (
    <Dialog open width="md" title={rule ? `Edit ${rule.label}` : "New port forward"} icon={<Waypoints size={15} />} onOpenChange={(open) => !open && onClose()}>
      <form aria-label="Port forward" onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Label" hint="Defaults to the ssh flag">
            <Input {...text("label")} placeholder="Postgres on prod" />
          </Field>
          <Field label="Through host" error={errors.hostId}>
            <Select aria-label="Through host" value={values.hostId} onChange={(e) => set("hostId", e.target.value)} aria-invalid={errors.hostId ? true : undefined}>
              <option value="">Choose a host…</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <SegmentedControl
          label="Forward type"
          value={values.kind}
          onChange={(kind) => set("kind", kind)}
          options={[
            { value: "local", label: "Local" },
            { value: "remote", label: "Remote" },
            { value: "dynamic", label: "SOCKS proxy" },
          ]}
        />
        <p className="text-xs text-fg-muted">{labels.explain}</p>

        <fieldset className="grid grid-cols-[1fr_96px] gap-3">
          <legend className="mb-1 text-xs font-medium text-fg-2">{labels.listen}</legend>
          <Field label="Listen address" error={errors.listenHost}>
            <Input {...text("listenHost")} placeholder="127.0.0.1" />
          </Field>
          <Field label="Listen port" error={errors.listenPort}>
            <Input {...text("listenPort")} inputMode="numeric" placeholder={values.kind === "dynamic" ? "1080" : "15432"} />
          </Field>
        </fieldset>
        {exposesToNetwork(values) && (
          <p role="note" className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft p-2 text-xs text-warn">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            Other machines on your network will be able to use this port. Keep 127.0.0.1 unless you mean to share it.
          </p>
        )}

        {values.kind !== "dynamic" && (
          <fieldset className="grid grid-cols-[1fr_96px] gap-3">
            <legend className="mb-1 text-xs font-medium text-fg-2">{labels.destination}</legend>
            <Field label="Destination host" error={errors.destinationHost}>
              <Input {...text("destinationHost")} placeholder={values.kind === "local" ? "db.internal" : "127.0.0.1"} />
            </Field>
            <Field label="Destination port" error={errors.destinationPort}>
              <Input {...text("destinationPort")} inputMode="numeric" placeholder="5432" />
            </Field>
          </fieldset>
        )}

        <Checkbox
          label="Start automatically"
          description="Whenever a terminal tab to this host connects."
          checked={values.autoStart}
          onChange={(e) => set("autoStart", e.target.checked)}
        />

        {serverError && (
          <p role="alert" className="text-[13px] text-danger">
            {serverError}
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

type TextField = "label" | "listenHost" | "listenPort" | "destinationHost" | "destinationPort";
const fieldLabels: Record<TextField, string> = {
  label: "Label",
  listenHost: "Listen address",
  listenPort: "Listen port",
  destinationHost: "Destination host",
  destinationPort: "Destination port",
};

function textProps(values: ForwardFormValues, errors: ForwardFormErrors, set: (key: TextField, value: string) => void) {
  return (key: TextField) => ({
    "aria-label": fieldLabels[key],
    "aria-invalid": key !== "label" && errors[key] ? true : undefined,
    value: values[key],
    spellCheck: false,
    onChange: (e: { target: { value: string } }) => set(key, e.target.value),
  });
}

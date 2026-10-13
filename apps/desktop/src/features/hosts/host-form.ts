import type { HostInput, HostView, PasswordChange } from "@/bindings";

export type SavedPasswordAction = "keep" | "replace" | "clear";

export interface HostFormValues {
  label: string;
  hostname: string;
  port: string;
  username: string;
  authMethod: "password" | "agent";
  password: string;
  savedPasswordAction: SavedPasswordAction;
  groupId: string;
  jumpHostId: string;
  tags: string;
  notes: string;
  keepaliveSecs: string;
}

export type HostFormErrors = Partial<Record<keyof HostFormValues, string>>;

export type HostFormResult = { ok: true; input: HostInput } | { ok: false; errors: HostFormErrors };

export function hostFormValues(host?: HostView): HostFormValues {
  return {
    label: host?.label ?? "",
    hostname: host?.hostname ?? "",
    port: String(host?.port ?? 22),
    username: host?.username ?? "",
    authMethod: host?.auth.method === "agent" ? "agent" : "password",
    password: "",
    savedPasswordAction: "keep",
    groupId: host?.groupId ?? "",
    jumpHostId: host?.jumpHostId ?? "",
    tags: host?.tags.join(", ") ?? "",
    notes: host?.notes ?? "",
    keepaliveSecs: host?.keepaliveSecs == null ? "" : String(host.keepaliveSecs),
  };
}

function passwordChange(values: HostFormValues, hasSavedPassword: boolean): PasswordChange {
  if (hasSavedPassword) {
    if (values.savedPasswordAction === "keep") return { kind: "keep" };
    if (values.savedPasswordAction === "clear") return { kind: "clear" };
  }
  return values.password ? { kind: "set", value: values.password } : { kind: "clear" };
}

/** Validates the form; `hasSavedPassword` is true when editing a host that already stores one. */
export function hostInputFromForm(values: HostFormValues, hasSavedPassword = false): HostFormResult {
  const errors: HostFormErrors = {};
  const hostname = values.hostname.trim();
  const port = Number(values.port.trim() || "22");
  const keepalive = values.keepaliveSecs.trim();
  const keepaliveSecs = keepalive === "" ? null : Number(keepalive);

  if (!hostname) errors.hostname = "Host is required";
  else if (/\s/.test(hostname)) errors.hostname = "Host must not contain spaces";
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "Port must be 1–65535";
  if (keepaliveSecs !== null && (!Number.isInteger(keepaliveSecs) || keepaliveSecs < 0 || keepaliveSecs > 3600)) {
    errors.keepaliveSecs = "Keepalive must be 0–3600 seconds";
  }
  if (hasSavedPassword && values.savedPasswordAction === "replace" && !values.password) {
    errors.password = "Enter the new password";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      label: values.label.trim(),
      hostname,
      port,
      username: values.username.trim() || null,
      auth:
        values.authMethod === "agent"
          ? { method: "agent" }
          : { method: "password", password: passwordChange(values, hasSavedPassword) },
      groupId: values.groupId || null,
      jumpHostId: values.jumpHostId || null,
      tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: values.notes,
      keepaliveSecs,
    },
  };
}

import type { AuthInput, EnvironmentView, HostInput, HostView, PasswordChange } from "@/bindings";
import type { TabColor } from "@/features/tabs/tab-color";

export type SavedPasswordAction = "keep" | "replace" | "clear";
export type AuthChoice = "password" | "key" | "agent";

export interface HostFormValues {
  label: string;
  hostname: string;
  port: string;
  username: string;
  authMethod: AuthChoice;
  password: string;
  savedPasswordAction: SavedPasswordAction;
  keyId: string;
  groupId: string;
  jumpHostId: string;
  tags: string;
  notes: string;
  keepaliveSecs: string;
  color: TabColor | null;
  aiDisabled: boolean;
  environment: EnvironmentView | "none";
}

export type HostFormErrors = Partial<Record<keyof HostFormValues, string>>;

export type HostFormResult = { ok: true; input: HostInput } | { ok: false; errors: HostFormErrors };

const authChoiceOf = (host?: HostView): AuthChoice =>
  host?.auth.method === "agent" ? "agent" : host?.auth.method === "identity" ? "key" : "password";

export function hostFormValues(host?: HostView): HostFormValues {
  return {
    label: host?.label ?? "",
    hostname: host?.hostname ?? "",
    port: String(host?.port ?? 22),
    username: host?.username ?? "",
    authMethod: authChoiceOf(host),
    password: "",
    savedPasswordAction: "keep",
    keyId: host?.auth.method === "identity" ? host.auth.identityId : "",
    groupId: host?.groupId ?? "",
    jumpHostId: host?.jumpHostId ?? "",
    tags: host?.tags.join(", ") ?? "",
    notes: host?.notes ?? "",
    keepaliveSecs: host?.keepaliveSecs == null ? "" : String(host.keepaliveSecs),
    color: (host?.color as TabColor | null | undefined) ?? null,
    aiDisabled: host?.aiDisabled ?? false,
    environment: host?.environment ?? "none",
  };
}

function passwordChange(values: HostFormValues, hasSavedPassword: boolean): PasswordChange {
  if (hasSavedPassword) {
    if (values.savedPasswordAction === "keep") return { kind: "keep" };
    if (values.savedPasswordAction === "clear") return { kind: "clear" };
  }
  return values.password ? { kind: "set", value: values.password } : { kind: "clear" };
}

function authInput(values: HostFormValues, hasSavedPassword: boolean): AuthInput {
  switch (values.authMethod) {
    case "agent":
      return { method: "agent" };
    case "key":
      return { method: "identity", identityId: values.keyId };
    case "password":
      return { method: "password", password: passwordChange(values, hasSavedPassword) };
  }
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
  if (values.authMethod === "password" && hasSavedPassword && values.savedPasswordAction === "replace" && !values.password) {
    errors.password = "Enter the new password";
  }
  if (values.authMethod === "key" && !values.keyId) errors.keyId = "Choose a key";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      label: values.label.trim(),
      hostname,
      port,
      username: values.username.trim() || null,
      auth: authInput(values, hasSavedPassword),
      groupId: values.groupId || null,
      jumpHostId: values.jumpHostId || null,
      tags: values.tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: values.notes,
      keepaliveSecs,
      color: values.color,
      aiDisabled: values.aiDisabled,
      environment: values.environment === "none" ? null : values.environment,
    },
  };
}

import type { PasswordSessionRequest } from "@/bindings";

export interface ConnectFormValues {
  host: string;
  port: string;
  username: string;
  password: string;
}

export type ConnectFormErrors = Partial<Record<keyof ConnectFormValues, string>>;

export type ParsedConnectForm =
  | { ok: true; login: Omit<PasswordSessionRequest, "cols" | "rows" | "trustedFingerprint"> }
  | { ok: false; errors: ConnectFormErrors };

export function parseConnectForm(values: ConnectFormValues): ParsedConnectForm {
  const errors: ConnectFormErrors = {};
  const host = values.host.trim();
  const username = values.username.trim();
  const port = Number(values.port.trim() || "22");

  if (!host) errors.host = "Host is required";
  else if (/\s/.test(host)) errors.host = "Host must not contain spaces";
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = "Port must be 1–65535";
  if (!username) errors.username = "Username is required";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, login: { host, port, username, password: values.password } };
}

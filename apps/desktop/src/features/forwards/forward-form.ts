import type { ForwardRuleInput, ForwardRuleView, ForwardSpecDto } from "@/bindings";

export type ForwardKind = ForwardSpecDto["kind"];

/** Every field as typed; only the ones for `kind` are used. */
export interface ForwardFormValues {
  label: string;
  hostId: string;
  kind: ForwardKind;
  listenHost: string;
  listenPort: string;
  destinationHost: string;
  destinationPort: string;
  autoStart: boolean;
}

export type ForwardFormErrors = Partial<Record<"hostId" | "listenPort" | "destinationHost" | "destinationPort" | "listenHost", string>>;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function forwardFormValues(rule?: ForwardRuleView, defaultHostId = ""): ForwardFormValues {
  const base = { label: rule?.label ?? "", hostId: rule?.hostId ?? defaultHostId, autoStart: rule?.autoStart ?? false };
  const spec = rule?.spec;
  switch (spec?.kind) {
    case "remote":
      return { ...base, kind: "remote", listenHost: spec.remoteHost, listenPort: String(spec.remotePort), destinationHost: spec.localHost, destinationPort: String(spec.localPort) };
    case "dynamic":
      return { ...base, kind: "dynamic", listenHost: spec.bindHost, listenPort: String(spec.bindPort), destinationHost: "", destinationPort: "" };
    case "local":
      return { ...base, kind: "local", listenHost: spec.bindHost, listenPort: String(spec.bindPort), destinationHost: spec.targetHost, destinationPort: String(spec.targetPort) };
    default:
      return { ...base, kind: "local", listenHost: "127.0.0.1", listenPort: "", destinationHost: "", destinationPort: "" };
  }
}

function parsePort(text: string, allowZero: boolean): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= 65535 && (n > 0 || allowZero) ? n : null;
}

/** True when the listener would accept connections from other machines. */
export function exposesToNetwork(values: ForwardFormValues): boolean {
  const host = values.listenHost.trim() || "127.0.0.1";
  return values.kind !== "remote" && !LOOPBACK.has(host);
}

export function forwardInputFromForm(values: ForwardFormValues): { ok: true; input: ForwardRuleInput } | { ok: false; errors: ForwardFormErrors } {
  const errors: ForwardFormErrors = {};
  if (!values.hostId) errors.hostId = "Choose the host to tunnel through";
  if (/\s/.test(values.listenHost.trim())) errors.listenHost = "No spaces";
  // A remote listen port of 0 lets the server pick a free one.
  const listenPort = parsePort(values.listenPort, values.kind === "remote");
  if (listenPort === null) errors.listenPort = values.kind === "remote" ? "0–65535" : "1–65535";
  let destinationPort = 0;
  if (values.kind !== "dynamic") {
    if (values.kind === "local" && !values.destinationHost.trim()) errors.destinationHost = "Required";
    const port = parsePort(values.destinationPort, false);
    if (port === null) errors.destinationPort = "1–65535";
    else destinationPort = port;
  }
  if (Object.keys(errors).length > 0 || listenPort === null) return { ok: false, errors };

  const listenHost = values.listenHost.trim();
  const destinationHost = values.destinationHost.trim();
  const spec: ForwardSpecDto =
    values.kind === "local"
      ? { kind: "local", bindHost: listenHost, bindPort: listenPort, targetHost: destinationHost, targetPort: destinationPort }
      : values.kind === "remote"
        ? { kind: "remote", remoteHost: listenHost, remotePort: listenPort, localHost: destinationHost, localPort: destinationPort }
        : { kind: "dynamic", bindHost: listenHost, bindPort: listenPort };
  return { ok: true, input: { label: values.label.trim(), hostId: values.hostId, spec, autoStart: values.autoStart } };
}

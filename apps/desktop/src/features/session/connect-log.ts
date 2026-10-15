import type { CommandError, ConnectProgress } from "@/bindings";

/** The stages shown while connecting, in the order SSH goes through them. */
export const CONNECT_STEPS = ["Open", "Connect", "Verify", "Log in", "Terminal"] as const;
export type StepIndex = 0 | 1 | 2 | 3 | 4;

export type LogLevel = "info" | "ok" | "wait" | "error";

export interface LogLine {
  at: number;
  level: LogLevel;
  text: string;
  /** A hint on what to do, for failures. */
  hint?: string;
}

const METHOD: Record<string, string> = { password: "password", key: "SSH key", agent: "ssh-agent keys" };

/** The step a progress event moves the display to. */
export function stepOf(progress: ConnectProgress): StepIndex {
  switch (progress.kind) {
    case "started":
      return 1;
    case "reached":
      return 1;
    case "serverIdentity":
      return 2;
    case "authenticating":
    case "authenticated":
      return 3;
    case "openingShell":
      return 4;
  }
}

/** The offered key as the user knows it: `"vps" (SHA256:…)`, or just the fingerprint. */
function keyName(fingerprint: string, label: string | null | undefined): string {
  return label ? `"${label}" (${fingerprint})` : fingerprint;
}

/** One plain-language log line per progress event; `labelOf` names a key by its fingerprint. */
export function describeProgress(progress: ConnectProgress, labelOf: (fingerprint: string) => string | null = () => null): Omit<LogLine, "at"> {
  switch (progress.kind) {
    case "started": {
      const where = `${progress.host}:${progress.port}`;
      if (progress.via === "direct") return { level: "info", text: `Connecting to ${where}…` };
      if (progress.via === "proxy") return { level: "info", text: `Starting the proxy command for ${where}…` };
      return { level: "info", text: `Connecting to ${where} through jump host ${progress.via}…` };
    }
    case "reached":
      return { level: "ok", text: `Reached ${progress.host}; starting a secure session` };
    case "serverIdentity":
      return { level: "info", text: `Server identity: ${progress.algorithm} ${progress.fingerprint}` };
    case "authenticating": {
      const how =
        progress.method === "key" && progress.keyFingerprint
          ? `SSH key ${keyName(progress.keyFingerprint, labelOf(progress.keyFingerprint))}`
          : (METHOD[progress.method] ?? progress.method);
      return { level: "info", text: `Logging in as ${progress.user} with ${how}…` };
    }
    case "authenticated":
      return { level: "ok", text: `Logged in to ${progress.host} as ${progress.user}` };
    case "openingShell":
      return { level: "ok", text: "Opening the terminal…" };
  }
}

interface Target {
  hostname: string;
  port: number;
  username: string | null;
}

export interface OfferedKey {
  fingerprint: string;
  label: string | null;
}

/** "invalid data: port must be…" → "Port must be…": the error kind is not for people. */
function plainMessage(message: string): string {
  const text = message.replace(/^invalid data:\s*/i, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A failure in plain words, with what to try next; `offered` names the key the server refused. */
export function explainError(error: Pick<CommandError, "code" | "message">, target: Target, offered?: OfferedKey | null): Omit<LogLine, "at"> {
  const m = plainMessage(error.message);
  const lower = m.toLowerCase();
  const where = `${target.hostname}:${target.port}`;
  const user = target.username ?? "the user";

  if (lower.includes("proxy command")) {
    return { level: "error", text: m, hint: "The proxy command failed. Run it in a terminal to see why (is the tool installed and signed in?)." };
  }
  if (lower.includes("jump host")) {
    return { level: "error", text: m, hint: "The problem is on the jump host, not the target: check its address, user and key." };
  }
  switch (error.code) {
    case "timeout":
      return { level: "error", text: `No answer from ${where} in time.`, hint: "Check the address and port, your VPN or network, and any firewall between you and the server." };
    case "unreachable":
      if (lower.includes("refused")) {
        return { level: "error", text: `${where} refused the connection.`, hint: "SSH may not be running there, or it listens on another port." };
      }
      if (lower.includes("lookup") || lower.includes("nodename") || lower.includes("not known") || lower.includes("no such host")) {
        return { level: "error", text: `Could not find ${target.hostname}.`, hint: "Check the spelling of the host name, or your DNS / VPN." };
      }
      if (lower.includes("unreachable") || lower.includes("no route")) {
        return { level: "error", text: `No route to ${where}.`, hint: "The network cannot reach this address: VPN off, wrong subnet or the machine is down." };
      }
      return { level: "error", text: m, hint: "The server could not be reached." };
    case "authentication_failed":
      return {
        level: "error",
        text: `${target.hostname} rejected the login for ${user}.`,
        hint: "Check the username (it is case-sensitive) and the password or key. For a key, its public half must be in ~/.ssh/authorized_keys on the server.",
      };
    case "host_key_rejected":
      return { level: "error", text: "The server's identity was not trusted, so the connection stopped.", hint: "Connect again and confirm the fingerprint if you expected it." };
    case "agent_unavailable":
      return { level: "error", text: "No ssh-agent is running.", hint: "Start ssh-agent and add your key (ssh-add), or choose a key for this host instead." };
    case "wrong_passphrase":
      return { level: "error", text: "Wrong passphrase for the key.", hint: "Try again; the passphrase is the one you set when creating the key." };
    case "invalid_data":
      if (lower.includes("did not accept the key")) {
        return {
          level: "error",
          text: offered ? `${target.hostname} rejected the key ${keyName(offered.fingerprint, offered.label)} for user ${user}.` : m,
          hint:
            `That key's public half must be in ~/.ssh/authorized_keys for "${user}" on the server (usernames are case-sensitive). ` +
            "If ssh works from a terminal, it is probably using a different key: import that one (often ~/.ssh/id_ed25519) and choose it for this host.",
        };
      }
      return { level: "error", text: m };
    default:
      return { level: "error", text: m };
  }
}

export const logTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The log as text, for "Copy log". */
export function plainLog(lines: LogLine[]): string {
  return lines.map((l) => `${logTime(l.at)}  ${l.text}${l.hint ? `\n          ${l.hint}` : ""}`).join("\n");
}

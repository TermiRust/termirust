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

/** One plain-language log line per progress event. */
export function describeProgress(progress: ConnectProgress): Omit<LogLine, "at"> {
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
    case "authenticating":
      return { level: "info", text: `Logging in as ${progress.user} with ${METHOD[progress.method] ?? progress.method}…` };
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

/** A failure in plain words, with what to try next. */
export function explainError(error: Pick<CommandError, "code" | "message">, target: Target): Omit<LogLine, "at"> {
  const m = error.message;
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
          text: m.charAt(0).toUpperCase() + m.slice(1),
          hint: `Check that the username "${user}" is right (case-sensitive) and that this key's public half is in ~/.ssh/authorized_keys for that user.`,
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

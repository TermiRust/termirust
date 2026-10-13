import type { OpenHostOutcome } from "@/bindings";

import type { CredentialsRequest } from "./credentials-prompt";

/** What the user must answer before a connection to a saved host can go ahead. */
export type HostPrompt =
  | { phase: "needsPassword"; usernameRequired: boolean; savedPasswordRejected: boolean }
  | { phase: "needsPassphrase"; keyLabel: string; wrongPassphrase: boolean; usernameRequired: boolean }
  | { phase: "needsUsername" }
  | { phase: "hostKeyUnknown"; server: string; algorithm: string; fingerprint: string }
  | { phase: "hostKeyChanged"; server: string; algorithm: string; fingerprint: string; previousFingerprint: string };

export function hostPromptOf(outcome: Exclude<OpenHostOutcome, { status: "opened" }>): HostPrompt {
  switch (outcome.status) {
    case "needsPassword":
      return { phase: "needsPassword", usernameRequired: outcome.usernameRequired, savedPasswordRejected: outcome.savedPasswordRejected };
    case "needsPassphrase":
      return {
        phase: "needsPassphrase",
        keyLabel: outcome.keyLabel,
        wrongPassphrase: outcome.wrongPassphrase,
        usernameRequired: outcome.usernameRequired,
      };
    case "needsUsername":
      return { phase: "needsUsername" };
    case "hostKeyUnknown":
      return { phase: "hostKeyUnknown", server: outcome.server, algorithm: outcome.algorithm, fingerprint: outcome.fingerprint };
    case "hostKeyChanged":
      return {
        phase: "hostKeyChanged",
        server: outcome.server,
        algorithm: outcome.algorithm,
        fingerprint: outcome.fingerprint,
        previousFingerprint: outcome.previousFingerprint,
      };
  }
}

const PROMPT_PHASES = new Set<string>(["needsPassword", "needsPassphrase", "needsUsername", "hostKeyUnknown", "hostKeyChanged"]);

export function isHostPrompt(state: { phase: string }): state is HostPrompt {
  return PROMPT_PHASES.has(state.phase);
}

/** The credentials dialog to show for a connection state, if it is waiting on one. */
export function credentialsRequestOf(state: { phase: string }): CredentialsRequest | null {
  if (!isHostPrompt(state)) return null;
  switch (state.phase) {
    case "needsPassword":
      return { kind: "password", usernameRequired: state.usernameRequired, savedPasswordRejected: state.savedPasswordRejected };
    case "needsPassphrase":
      return { kind: "passphrase", keyLabel: state.keyLabel, wrongPassphrase: state.wrongPassphrase, usernameRequired: state.usernameRequired };
    case "needsUsername":
      return { kind: "username" };
    default:
      return null;
  }
}

import { describe, expect, it } from "vitest";

import { credentialsRequestOf, hostPromptOf } from "./host-prompt";

describe("hostPromptOf", () => {
  it("maps every prompt outcome to a phase", () => {
    expect(hostPromptOf({ status: "needsUsername" })).toEqual({ phase: "needsUsername" });
    expect(hostPromptOf({ status: "needsPassword", usernameRequired: true, savedPasswordRejected: false })).toEqual({
      phase: "needsPassword",
      usernameRequired: true,
      savedPasswordRejected: false,
    });
    expect(hostPromptOf({ status: "needsPassphrase", keyLabel: "k", wrongPassphrase: true, usernameRequired: false })).toMatchObject({
      phase: "needsPassphrase",
      keyLabel: "k",
    });
    expect(hostPromptOf({ status: "hostKeyUnknown", server: "s", algorithm: "a", fingerprint: "f" })).toMatchObject({ phase: "hostKeyUnknown" });
    expect(
      hostPromptOf({ status: "hostKeyChanged", server: "s", algorithm: "a", fingerprint: "f", previousFingerprint: "p" }),
    ).toMatchObject({ phase: "hostKeyChanged", previousFingerprint: "p" });
  });

  it("asks for credentials only in credential phases", () => {
    expect(credentialsRequestOf({ phase: "connected" })).toBeNull();
    expect(credentialsRequestOf({ phase: "hostKeyUnknown", server: "s", algorithm: "a", fingerprint: "f" } as never)).toBeNull();
    expect(credentialsRequestOf({ phase: "needsUsername" })).toEqual({ kind: "username" });
    expect(
      credentialsRequestOf({ phase: "needsPassphrase", keyLabel: "k", wrongPassphrase: false, usernameRequired: true } as never),
    ).toEqual({ kind: "passphrase", keyLabel: "k", wrongPassphrase: false, usernameRequired: true });
  });
});

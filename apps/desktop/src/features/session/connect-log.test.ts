import { describe, expect, it } from "vitest";

import { describeProgress, explainError, stepOf } from "./connect-log";

const target = { hostname: "203.0.113.10", port: 22, username: "Root" };

describe("connect log", () => {
  it("moves through the steps in SSH order", () => {
    expect(stepOf({ kind: "started", host: "h", port: 22, via: "direct" })).toBe(1);
    expect(stepOf({ kind: "serverIdentity", host: "h", algorithm: "ssh-ed25519", fingerprint: "SHA256:x" })).toBe(2);
    expect(stepOf({ kind: "authenticating", host: "h", user: "u", method: "key" })).toBe(3);
    expect(stepOf({ kind: "openingShell" })).toBe(4);
  });

  it("describes each event in plain words", () => {
    expect(describeProgress({ kind: "started", host: "db", port: 22, via: "bastion" }).text).toBe("Connecting to db:22 through jump host bastion…");
    expect(describeProgress({ kind: "started", host: "debian.example.app", port: 22, via: "proxy" }).text).toMatch(/proxy command/);
    expect(describeProgress({ kind: "authenticating", host: "h", user: "root", method: "key" }).text).toBe("Logging in as root with SSH key…");
    expect(describeProgress({ kind: "authenticated", host: "h", user: "root" })).toMatchObject({ level: "ok" });
  });

  it("explains common failures with a next step", () => {
    expect(explainError({ code: "unreachable", message: "cannot reach h:22: Connection refused (os error 61)" }, target)).toMatchObject({
      text: "203.0.113.10:22 refused the connection.",
    });
    expect(explainError({ code: "unreachable", message: "failed to lookup address information: nodename nor servname provided" }, target).text).toBe(
      "Could not find 203.0.113.10.",
    );
    expect(explainError({ code: "timeout", message: "timed out after 15s" }, target).hint).toMatch(/VPN/);
    const key = explainError({ code: "invalid_data", message: "203.0.113.10 did not accept the key for user Root" }, target);
    expect(key.hint).toMatch(/"Root" is right \(case-sensitive\)/);
    expect(explainError({ code: "authentication_failed", message: "x" }, target).hint).toMatch(/authorized_keys/);
    expect(explainError({ code: "unreachable", message: "the proxy command failed: websocket: bad handshake" }, target).hint).toMatch(/proxy command/);
  });
});

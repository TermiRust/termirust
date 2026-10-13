import { describe, expect, it } from "vitest";

import { parseConnectForm, type ConnectFormValues } from "./connect-form";

const valid: ConnectFormValues = { host: " 127.0.0.1 ", port: "2222", username: " termirust ", password: " secret " };

describe("parseConnectForm", () => {
  it("trims host and username but keeps the password verbatim", () => {
    expect(parseConnectForm(valid)).toEqual({
      ok: true,
      login: { host: "127.0.0.1", port: 2222, username: "termirust", password: " secret " },
    });
  });

  it("defaults an empty port to 22", () => {
    const result = parseConnectForm({ ...valid, port: "" });
    expect(result.ok && result.login.port).toBe(22);
  });

  it.each([
    ["0", "Port must be 1–65535"],
    ["65536", "Port must be 1–65535"],
    ["22.5", "Port must be 1–65535"],
    ["abc", "Port must be 1–65535"],
  ])("rejects port %s", (port, message) => {
    expect(parseConnectForm({ ...valid, port })).toEqual({ ok: false, errors: { port: message } });
  });

  it("requires host and username", () => {
    expect(parseConnectForm({ ...valid, host: "  ", username: "" })).toEqual({
      ok: false,
      errors: { host: "Host is required", username: "Username is required" },
    });
  });

  it("rejects a host containing spaces", () => {
    expect(parseConnectForm({ ...valid, host: "my host" })).toEqual({
      ok: false,
      errors: { host: "Host must not contain spaces" },
    });
  });
});

import { describe, expect, it } from "vitest";

import type { HostView } from "@/bindings";

import { hostFormValues, hostInputFromForm, type HostFormValues } from "./host-form";

const blank = hostFormValues();
const filled: HostFormValues = { ...blank, label: " Prod ", hostname: " 10.0.0.1 ", username: " deploy ", tags: "prod, , eu" };

describe("hostFormValues", () => {
  it("defaults a new host to port 22 and password auth", () => {
    expect(blank).toMatchObject({ port: "22", authMethod: "password", savedPasswordAction: "keep", keyId: "", keepaliveSecs: "" });
  });

  it("prefills from an existing host without any password", () => {
    const host: HostView = {
      id: "1",
      label: "db",
      hostname: "db.internal",
      port: 2222,
      username: "pg",
      auth: { method: "agent" },
      groupId: "g",
      jumpHostId: null,
      tags: ["a", "b"],
      notes: "n",
      keepaliveSecs: 60,
      color: null,
      aiDisabled: true,
    };
    expect(hostFormValues(host)).toEqual({
      label: "db",
      hostname: "db.internal",
      port: "2222",
      username: "pg",
      authMethod: "agent",
      password: "",
      savedPasswordAction: "keep",
      keyId: "",
      groupId: "g",
      jumpHostId: "",
      tags: "a, b",
      notes: "n",
      keepaliveSecs: "60",
      color: null,
      aiDisabled: true,
    });
  });
});

describe("hostInputFromForm", () => {
  it("trims fields, splits tags and turns empty strings into null", () => {
    const result = hostInputFromForm(filled);
    expect(result).toEqual({
      ok: true,
      input: {
        label: "Prod",
        hostname: "10.0.0.1",
        port: 22,
        username: "deploy",
        auth: { method: "password", password: { kind: "clear" } },
        groupId: null,
        jumpHostId: null,
        tags: ["prod", "eu"],
        notes: "",
        keepaliveSecs: null, aiDisabled: false,
        color: null,
      },
    });
  });

  it("saves a typed password for a new host", () => {
    const result = hostInputFromForm({ ...filled, password: "pw" });
    expect(result.ok && result.input.auth).toEqual({ method: "password", password: { kind: "set", value: "pw" } });
  });

  it("keeps, replaces or clears a password the host already stores", () => {
    const auth = (v: Partial<HostFormValues>) => {
      const r = hostInputFromForm({ ...filled, ...v }, true);
      return r.ok ? r.input.auth : r.errors;
    };
    expect(auth({ savedPasswordAction: "keep", password: "ignored" })).toEqual({ method: "password", password: { kind: "keep" } });
    expect(auth({ savedPasswordAction: "clear" })).toEqual({ method: "password", password: { kind: "clear" } });
    expect(auth({ savedPasswordAction: "replace", password: "new" })).toEqual({
      method: "password",
      password: { kind: "set", value: "new" },
    });
    expect(auth({ savedPasswordAction: "replace", password: "" })).toEqual({ password: "Enter the new password" });
  });

  it("prefills a key host with its key", () => {
    const values = hostFormValues({
      id: "1",
      label: "git",
      hostname: "github.com",
      port: 22,
      username: "git",
      auth: { method: "identity", identityId: "k1" },
      groupId: null,
      jumpHostId: null,
      tags: [],
      notes: "",
      keepaliveSecs: null, aiDisabled: false,
    color: null,
    });
    expect([values.authMethod, values.keyId]).toEqual(["key", "k1"]);
  });

  it("uses the chosen key and requires one", () => {
    const chosen = hostInputFromForm({ ...filled, authMethod: "key", keyId: "k1" });
    expect(chosen.ok && chosen.input.auth).toEqual({ method: "identity", identityId: "k1" });
    expect(hostInputFromForm({ ...filled, authMethod: "key", keyId: "" })).toEqual({ ok: false, errors: { keyId: "Choose a key" } });
  });

  it("carries the tab colour override", () => {
    const result = hostInputFromForm({ ...filled, color: "violet" });
    expect(result.ok && result.input.color).toBe("violet");
  });

  it("uses agent auth without any password", () => {
    const result = hostInputFromForm({ ...filled, authMethod: "agent", password: "pw" });
    expect(result.ok && result.input.auth).toEqual({ method: "agent" });
  });

  it.each([
    [{ hostname: "  " }, { hostname: "Host is required" }],
    [{ hostname: "my host" }, { hostname: "Host must not contain spaces" }],
    [{ port: "70000" }, { port: "Port must be 1–65535" }],
    [{ keepaliveSecs: "-1" }, { keepaliveSecs: "Keepalive must be 0–3600 seconds" }],
    [{ keepaliveSecs: "1.5" }, { keepaliveSecs: "Keepalive must be 0–3600 seconds" }],
  ])("rejects %j", (patch, errors) => {
    expect(hostInputFromForm({ ...filled, ...patch })).toEqual({ ok: false, errors });
  });

  it("accepts an explicit keepalive and an empty port as 22", () => {
    const result = hostInputFromForm({ ...filled, port: "", keepaliveSecs: "45" });
    expect(result.ok && [result.input.port, result.input.keepaliveSecs]).toEqual([22, 45]);
  });
});

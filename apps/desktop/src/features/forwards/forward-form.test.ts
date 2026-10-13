import { describe, expect, it } from "vitest";

import type { ForwardRuleView } from "@/bindings";

import { exposesToNetwork, forwardFormValues, forwardInputFromForm } from "./forward-form";

const view = (spec: ForwardRuleView["spec"]): ForwardRuleView => ({ id: "r1", label: "db", hostId: "h1", spec, autoStart: true, summary: "" });

describe("forward form", () => {
  it("starts new rules on loopback with the given host", () => {
    expect(forwardFormValues(undefined, "h9")).toMatchObject({ hostId: "h9", kind: "local", listenHost: "127.0.0.1", autoStart: false });
  });

  it("round-trips each kind of rule", () => {
    const specs: ForwardRuleView["spec"][] = [
      { kind: "local", bindHost: "127.0.0.1", bindPort: 15432, targetHost: "db", targetPort: 5432 },
      { kind: "remote", remoteHost: "127.0.0.1", remotePort: 0, localHost: "127.0.0.1", localPort: 3000 },
      { kind: "dynamic", bindHost: "127.0.0.1", bindPort: 1080 },
    ];
    for (const spec of specs) {
      const parsed = forwardInputFromForm(forwardFormValues(view(spec)));
      expect(parsed).toEqual({ ok: true, input: { label: "db", hostId: "h1", spec, autoStart: true } });
    }
  });

  it("explains what is missing or out of range", () => {
    const values = { ...forwardFormValues(), listenPort: "70000", destinationPort: "x", listenHost: "a b" };
    expect(forwardInputFromForm(values)).toEqual({
      ok: false,
      errors: { hostId: "Choose the host to tunnel through", listenHost: "No spaces", listenPort: "1–65535", destinationHost: "Required", destinationPort: "1–65535" },
    });
  });

  it("allows port 0 only for the server side of a remote forward", () => {
    const remote = { ...forwardFormValues(undefined, "h"), kind: "remote" as const, listenPort: "0", destinationPort: "3000" };
    expect(forwardInputFromForm(remote).ok).toBe(true);
    expect(forwardInputFromForm({ ...remote, kind: "dynamic" }).ok).toBe(false);
  });

  it("does not need a destination for a SOCKS proxy", () => {
    const dynamic = { ...forwardFormValues(undefined, "h"), kind: "dynamic" as const, listenPort: "1080" };
    expect(forwardInputFromForm(dynamic)).toMatchObject({ ok: true, input: { spec: { kind: "dynamic", bindPort: 1080 } } });
  });

  it("flags listeners other machines could reach", () => {
    const base = forwardFormValues(undefined, "h");
    expect(exposesToNetwork(base)).toBe(false);
    expect(exposesToNetwork({ ...base, listenHost: "localhost" })).toBe(false);
    expect(exposesToNetwork({ ...base, listenHost: "0.0.0.0" })).toBe(true);
    expect(exposesToNetwork({ ...base, kind: "remote", listenHost: "0.0.0.0" })).toBe(false);
  });
});

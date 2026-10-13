import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ForwardRuleView } from "@/bindings";

const commands = {
  forwardsList: vi.fn(),
  forwardsStatus: vi.fn(),
  forwardsCreate: vi.fn(),
  forwardsUpdate: vi.fn(),
  forwardsDelete: vi.fn(),
  forwardsStart: vi.fn(),
  forwardsStop: vi.fn(),
  forwardsAutoStart: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));

const { useForwardsStore } = await import("./forwards-store");

const ok = (data: unknown) => ({ status: "ok", data });
const rule = (id: string, overrides: Partial<ForwardRuleView> = {}): ForwardRuleView => ({
  id,
  label: id,
  hostId: "h1",
  spec: { kind: "dynamic", bindHost: "127.0.0.1", bindPort: 1080 },
  autoStart: false,
  summary: "-D 127.0.0.1:1080",
  ...overrides,
});
const store = () => useForwardsStore.getState();
const initial = useForwardsStore.getState();
const request = { ruleId: "r1", prompted: null, confirmedFingerprint: null, rememberHostKey: true };

describe("forwards store", () => {
  beforeEach(() => {
    useForwardsStore.setState(initial, true);
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.forwardsStatus.mockResolvedValue(ok([]));
  });

  it("loads rules and their live states", async () => {
    commands.forwardsList.mockResolvedValue(ok([rule("r1")]));
    commands.forwardsStatus.mockResolvedValue(ok([{ ruleId: "r1", state: { state: "running", listeningOn: "127.0.0.1:1080", active: 2, total: 5 } }]));
    await store().load();
    expect(store().rules).toHaveLength(1);
    expect(store().states.r1).toMatchObject({ state: "running", active: 2 });
  });

  it("keeps the load error for the screen", async () => {
    commands.forwardsList.mockResolvedValue({ status: "error", error: { code: "keychain", message: "locked" } });
    await store().load();
    expect(store()).toMatchObject({ loaded: true, error: "locked" });
  });

  it("creates, updates and removes rules", async () => {
    commands.forwardsCreate.mockResolvedValue(ok(rule("r1")));
    await store().create({ label: "", hostId: "h1", spec: rule("r1").spec, autoStart: false });
    commands.forwardsUpdate.mockResolvedValue(ok(rule("r1", { label: "proxy" })));
    useForwardsStore.setState({ states: { r1: { state: "running", listeningOn: "x", active: 0, total: 0 } } });
    await store().update("r1", { label: "proxy", hostId: "h1", spec: rule("r1").spec, autoStart: false });
    expect(store().rules[0]?.label).toBe("proxy");
    expect(store().states.r1).toEqual({ state: "stopped" });

    commands.forwardsDelete.mockResolvedValue(ok(null));
    await store().remove("r1");
    expect(store().rules).toEqual([]);
    expect(store().states.r1).toBeUndefined();
  });

  it("tracks starting, then the outcome of a start", async () => {
    let resolve: (value: unknown) => void = () => {};
    commands.forwardsStart.mockReturnValue(new Promise((r) => (resolve = r)));
    const starting = store().start(request);
    expect(store().states.r1).toEqual({ state: "starting" });
    resolve(ok({ status: "started", state: { state: "failed", message: "127.0.0.1:1080 is already in use" } }));
    await starting;
    expect(store().states.r1).toEqual({ state: "failed", message: "127.0.0.1:1080 is already in use" });
  });

  it("goes back to stopped while the start waits for a prompt", async () => {
    commands.forwardsStart.mockResolvedValue(ok({ status: "needsInput", prompt: { status: "needsUsername" } }));
    const result = await store().start(request);
    expect(result).toMatchObject({ data: { status: "needsInput" } });
    expect(store().states.r1).toEqual({ state: "stopped" });
  });

  it("stops a rule", async () => {
    commands.forwardsStop.mockResolvedValue(ok(null));
    await store().stop("r1");
    expect(commands.forwardsStop).toHaveBeenCalledWith("r1");
    expect(store().states.r1).toEqual({ state: "stopped" });
  });

  it("auto-starts only when the host has auto-start rules", async () => {
    useForwardsStore.setState({ loaded: true, rules: [rule("r1")] });
    await store().autoStart("h1");
    expect(commands.forwardsAutoStart).not.toHaveBeenCalled();

    useForwardsStore.setState({ rules: [rule("r1", { autoStart: true })] });
    commands.forwardsAutoStart.mockResolvedValue(ok([{ ruleId: "r1", state: { state: "running", listeningOn: "127.0.0.1:1080", active: 0, total: 0 } }]));
    await store().autoStart("h1");
    expect(store().states.r1).toMatchObject({ state: "running" });
  });

  it("asks the backend when rules were never loaded", async () => {
    commands.forwardsAutoStart.mockResolvedValue(ok([]));
    await store().autoStart("h1");
    expect(commands.forwardsAutoStart).toHaveBeenCalledWith("h1");
  });
});

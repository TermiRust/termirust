import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostView } from "@/bindings";
import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));

const commands = {
  sessionOpenHost: vi.fn(),
  sessionWrite: vi.fn(),
  sessionResize: vi.fn(),
  sessionClose: vi.fn(),
  sessionAcknowledgeOutput: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));

const { useHostSession } = await import("./use-host-session");

const host: HostView = {
  id: "h1",
  label: "prod",
  hostname: "10.0.0.1",
  port: 22,
  username: "deploy",
  auth: { method: "password", hasSavedPassword: true },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null,
};
const ok = (data: unknown) => ({ status: "ok", data });
const opened = (sessionId: number) => ok({ status: "opened", sessionId });

function setup() {
  const terminal = { write: vi.fn(), size: () => ({ cols: 100, rows: 30 }) };
  const hook = renderHook(() => useHostSession(host, () => terminal));
  return { terminal, hook };
}

describe("useHostSession", () => {
  beforeEach(() => {
    FakeChannel.created = [];
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.sessionClose.mockResolvedValue(ok(null));
  });

  it("connects immediately using what the vault holds", async () => {
    commands.sessionOpenHost.mockResolvedValue(opened(4));
    const { hook } = setup();

    await waitFor(() => expect(hook.result.current.state).toEqual({ phase: "connected", sessionId: 4 }));
    expect(commands.sessionOpenHost).toHaveBeenCalledOnce();
    expect(commands.sessionOpenHost.mock.calls[0]?.[0]).toEqual({
      hostId: "h1",
      cols: 100,
      rows: 30,
      prompted: null,
      confirmedFingerprint: null,
    });
  });

  it("asks for a password, then retries with what the user typed", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(ok({ status: "needsPassword", usernameRequired: false, savedPasswordRejected: true }))
      .mockResolvedValueOnce(opened(5));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("needsPassword"));
    expect(hook.result.current.state).toMatchObject({ savedPasswordRejected: true });

    await act(async () => hook.result.current.submitPassword({ username: null, password: "pw", remember: true }));
    await waitFor(() => expect(hook.result.current.state.phase).toBe("connected"));
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({
      prompted: { username: null, password: "pw", remember: true },
      confirmedFingerprint: null,
    });
  });

  it("keeps the typed password when the next step is confirming the host key", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(ok({ status: "needsPassword", usernameRequired: false, savedPasswordRejected: false }))
      .mockResolvedValueOnce(ok({ status: "hostKeyUnknown", algorithm: "ssh-ed25519", fingerprint: "SHA256:k" }))
      .mockResolvedValueOnce(opened(6));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("needsPassword"));
    await act(async () => hook.result.current.submitPassword({ username: null, password: "pw", remember: false }));
    await waitFor(() => expect(hook.result.current.state.phase).toBe("hostKeyUnknown"));

    await act(async () => hook.result.current.trustHostKey("SHA256:k"));
    await waitFor(() => expect(hook.result.current.state.phase).toBe("connected"));
    expect(commands.sessionOpenHost.mock.calls[2]?.[0]).toMatchObject({
      prompted: { password: "pw" },
      confirmedFingerprint: "SHA256:k",
    });
  });

  it("surfaces a changed host key with both fingerprints", async () => {
    commands.sessionOpenHost.mockResolvedValue(
      ok({ status: "hostKeyChanged", algorithm: "ssh-ed25519", fingerprint: "SHA256:new", previousFingerprint: "SHA256:old" }),
    );
    const { hook } = setup();
    await waitFor(() =>
      expect(hook.result.current.state).toEqual({
        phase: "hostKeyChanged",
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:new",
        previousFingerprint: "SHA256:old",
      }),
    );
  });

  it("shows backend errors and can cancel a prompt", async () => {
    commands.sessionOpenHost.mockResolvedValueOnce({
      status: "error",
      error: { code: "invalid_data", message: "SSH agent login is not supported yet" },
    });
    const { hook } = setup();
    await waitFor(() =>
      expect(hook.result.current.state).toEqual({ phase: "error", message: "SSH agent login is not supported yet" }),
    );
    act(() => hook.result.current.cancel());
    expect(hook.result.current.state).toEqual({ phase: "cancelled" });
  });

  it("streams output, acknowledges it and forwards keystrokes", async () => {
    commands.sessionOpenHost.mockResolvedValue(opened(7));
    const { hook, terminal } = setup();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("connected"));

    act(() => FakeChannel.created[0]?.emit(new Uint8Array(3).buffer));
    act(() => (terminal.write.mock.calls[0]?.[1] as () => void)());
    expect(commands.sessionAcknowledgeOutput).toHaveBeenCalledWith(7, 3);

    act(() => {
      hook.result.current.send("ls\r");
      hook.result.current.resize({ cols: 80, rows: 20 });
    });
    expect(commands.sessionWrite).toHaveBeenCalledWith(7, "ls\r");
    expect(commands.sessionResize).toHaveBeenCalledWith(7, 80, 20);
  });

  it("reports the remote shell closing and reconnects on request", async () => {
    commands.sessionOpenHost.mockResolvedValueOnce(opened(8)).mockResolvedValueOnce(opened(9));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("connected"));

    act(() => FakeChannel.created[1]?.emit({ exitStatus: 0 }));
    expect(hook.result.current.state).toEqual({ phase: "closed", exitStatus: 0 });

    await act(async () => hook.result.current.reconnect());
    await waitFor(() => expect(hook.result.current.state).toEqual({ phase: "connected", sessionId: 9 }));
  });

  it("closes the session when the view goes away", async () => {
    commands.sessionOpenHost.mockResolvedValue(opened(10));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("connected"));
    hook.unmount();
    expect(commands.sessionClose).toHaveBeenCalledWith(10);
  });

  it("closes a session that finishes opening after the view went away", async () => {
    let finish: (v: unknown) => void = () => {};
    commands.sessionOpenHost.mockReturnValue(new Promise((r) => (finish = r)));
    const { hook } = setup();
    hook.unmount();
    await act(async () => finish(opened(11)));
    expect(commands.sessionClose).toHaveBeenCalledWith(11);
  });

  it("disconnects on request", async () => {
    commands.sessionOpenHost.mockResolvedValue(opened(12));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("connected"));
    await act(() => hook.result.current.disconnect());
    expect(commands.sessionClose).toHaveBeenCalledWith(12);
    expect(hook.result.current.state).toEqual({ phase: "closed", exitStatus: null });
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));

const commands = {
  sessionOpenWithPassword: vi.fn(),
  sessionWrite: vi.fn(),
  sessionResize: vi.fn(),
  sessionClose: vi.fn(),
  sessionAcknowledgeOutput: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));

const { useSshSession } = await import("./use-ssh-session");

const login = { host: "10.0.0.5", port: 22, username: "deploy", password: "pw" };

function setup() {
  const terminal = { write: vi.fn(), size: () => ({ cols: 120, rows: 40 }) };
  const hook = renderHook(() => useSshSession(() => terminal));
  return { terminal, hook };
}

const opened = (sessionId: number) => ({ status: "ok", data: { status: "opened", sessionId } });

describe("useSshSession", () => {
  beforeEach(() => {
    FakeChannel.created = [];
    Object.values(commands).forEach((fn) => fn.mockReset());
  });

  it("opens a session with the terminal size and streams output into the terminal", async () => {
    commands.sessionOpenWithPassword.mockResolvedValue(opened(7));
    const { terminal, hook } = setup();

    await act(() => hook.result.current.connect(login));

    expect(commands.sessionOpenWithPassword).toHaveBeenCalledWith(
      { ...login, cols: 120, rows: 40, trustedFingerprint: null },
      expect.any(FakeChannel),
      expect.any(FakeChannel),
    );
    expect(hook.result.current.state).toEqual({ phase: "connected", sessionId: 7 });

    act(() => FakeChannel.created[0]?.emit(new Uint8Array([104, 105]).buffer));
    expect(Array.from(terminal.write.mock.calls[0]?.[0] as Uint8Array)).toEqual([104, 105]);
  });

  it("acknowledges output only after the terminal has rendered it", async () => {
    commands.sessionOpenWithPassword.mockResolvedValue(opened(7));
    const { terminal, hook } = setup();
    await act(() => hook.result.current.connect(login));

    act(() => FakeChannel.created[0]?.emit(new Uint8Array(3).buffer));
    expect(commands.sessionAcknowledgeOutput).not.toHaveBeenCalled();

    const onWritten = terminal.write.mock.calls[0]?.[1] as () => void;
    act(() => onWritten());
    expect(commands.sessionAcknowledgeOutput).toHaveBeenCalledWith(7, 3);
  });

  it("holds acknowledgements for output rendered before the session id is known", async () => {
    let finishOpen: (v: unknown) => void = () => {};
    commands.sessionOpenWithPassword.mockReturnValue(new Promise((r) => (finishOpen = r)));
    const { terminal, hook } = setup();

    let connecting: Promise<void> = Promise.resolve();
    act(() => {
      connecting = hook.result.current.connect(login);
    });
    act(() => FakeChannel.created[0]?.emit(new Uint8Array(4).buffer));
    act(() => FakeChannel.created[0]?.emit(new Uint8Array(6).buffer));
    act(() => terminal.write.mock.calls.forEach((call) => (call[1] as () => void)()));
    expect(commands.sessionAcknowledgeOutput).not.toHaveBeenCalled();

    await act(async () => {
      finishOpen(opened(11));
      await connecting;
    });
    expect(commands.sessionAcknowledgeOutput).toHaveBeenCalledExactlyOnceWith(11, 10);
  });

  it("forwards keystrokes and resizes only while connected", async () => {
    const { hook } = setup();
    act(() => {
      hook.result.current.send("ls\r");
      hook.result.current.resize({ cols: 90, rows: 30 });
    });
    expect(commands.sessionWrite).not.toHaveBeenCalled();
    expect(commands.sessionResize).not.toHaveBeenCalled();

    commands.sessionOpenWithPassword.mockResolvedValue(opened(3));
    await act(() => hook.result.current.connect(login));
    act(() => {
      hook.result.current.send("ls\r");
      hook.result.current.resize({ cols: 90, rows: 30 });
    });
    expect(commands.sessionWrite).toHaveBeenCalledWith(3, "ls\r");
    expect(commands.sessionResize).toHaveBeenCalledWith(3, 90, 30);
  });

  it("asks to confirm an unknown host key, then reconnects trusting that fingerprint", async () => {
    commands.sessionOpenWithPassword.mockResolvedValueOnce({
      status: "ok",
      data: { status: "hostKeyNeedsConfirmation", algorithm: "ssh-ed25519", fingerprint: "SHA256:abc" },
    });
    const { hook } = setup();

    await act(() => hook.result.current.connect(login));
    expect(hook.result.current.state).toEqual({
      phase: "confirmHostKey",
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:abc",
    });

    commands.sessionOpenWithPassword.mockResolvedValueOnce(opened(9));
    await act(() => hook.result.current.trustHostKeyAndConnect("SHA256:abc"));
    expect(commands.sessionOpenWithPassword).toHaveBeenLastCalledWith(
      expect.objectContaining({ trustedFingerprint: "SHA256:abc" }),
      expect.anything(),
      expect.anything(),
    );
    expect(hook.result.current.state).toEqual({ phase: "connected", sessionId: 9 });
  });

  it("returns to idle when the user rejects the host key", async () => {
    commands.sessionOpenWithPassword.mockResolvedValue({
      status: "ok",
      data: { status: "hostKeyNeedsConfirmation", algorithm: "ssh-ed25519", fingerprint: "SHA256:abc" },
    });
    const { hook } = setup();
    await act(() => hook.result.current.connect(login));

    act(() => hook.result.current.rejectHostKey());
    expect(hook.result.current.state).toEqual({ phase: "idle" });

    await act(() => hook.result.current.trustHostKeyAndConnect("SHA256:abc"));
    expect(commands.sessionOpenWithPassword).toHaveBeenCalledTimes(1);
  });

  it("shows the backend error message", async () => {
    commands.sessionOpenWithPassword.mockResolvedValue({
      status: "error",
      error: { code: "authentication_failed", message: "authentication failed" },
    });
    const { hook } = setup();
    await act(() => hook.result.current.connect(login));
    expect(hook.result.current.state).toEqual({ phase: "error", message: "authentication failed" });
  });

  it("reports the exit status when the remote shell closes", async () => {
    commands.sessionOpenWithPassword.mockResolvedValue(opened(4));
    const { hook } = setup();
    await act(() => hook.result.current.connect(login));

    act(() => FakeChannel.created[1]?.emit({ exitStatus: 0 }));
    expect(hook.result.current.state).toEqual({ phase: "closed", exitStatus: 0 });

    act(() => hook.result.current.send("x"));
    expect(commands.sessionWrite).not.toHaveBeenCalled();
  });

  it("closes the session on disconnect and ignores a second disconnect", async () => {
    commands.sessionOpenWithPassword.mockResolvedValue(opened(5));
    commands.sessionClose.mockResolvedValue({ status: "ok", data: null });
    const { hook } = setup();
    await act(() => hook.result.current.connect(login));

    await act(() => hook.result.current.disconnect());
    await act(() => hook.result.current.disconnect());
    expect(commands.sessionClose).toHaveBeenCalledOnce();
    expect(commands.sessionClose).toHaveBeenCalledWith(5);
    expect(hook.result.current.state).toEqual({ phase: "closed", exitStatus: null });
  });

  it("does nothing when the terminal is not mounted yet", async () => {
    const hook = renderHook(() => useSshSession(() => null));
    await act(() => hook.result.current.connect(login));
    expect(commands.sessionOpenWithPassword).not.toHaveBeenCalled();
    expect(hook.result.current.state).toEqual({ phase: "idle" });
  });
});

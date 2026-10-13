import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
vi.mock("@/features/terminal/terminal-view", () => ({
  TerminalView: forwardRef(function FakeTerminal(_props, ref) {
    useImperativeHandle(ref, () => ({ write: vi.fn(), clear: vi.fn(), focus: vi.fn(), size: () => ({ cols: 90, rows: 25 }) }));
    return <div data-testid="terminal" />;
  }),
}));

const commands = {
  sessionOpenLocal: vi.fn(),
  sessionWrite: vi.fn(),
  sessionResize: vi.fn(),
  sessionClose: vi.fn(),
  sessionAcknowledgeOutput: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));

const { useLocalSession } = await import("./use-local-session");
const { LocalSessionView } = await import("./local-session-view");

const ok = (data: unknown) => ({ status: "ok", data });

describe("useLocalSession", () => {
  beforeEach(() => {
    FakeChannel.created = [];
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.sessionClose.mockResolvedValue(ok(null));
  });

  function setup() {
    const terminal = { write: vi.fn(), size: () => ({ cols: 120, rows: 40 }) };
    return { terminal, hook: renderHook(() => useLocalSession(() => terminal)) };
  }

  it("starts a shell sized to the terminal and streams its output", async () => {
    commands.sessionOpenLocal.mockResolvedValue(ok(3));
    const { hook, terminal } = setup();
    await waitFor(() => expect(hook.result.current.state).toEqual({ phase: "running", sessionId: 3 }));
    expect(commands.sessionOpenLocal).toHaveBeenCalledWith(120, 40, expect.any(FakeChannel), expect.any(FakeChannel));

    act(() => FakeChannel.created[0]?.emit(new Uint8Array(4).buffer));
    act(() => (terminal.write.mock.calls[0]?.[1] as () => void)());
    expect(commands.sessionAcknowledgeOutput).toHaveBeenCalledWith(3, 4);

    act(() => {
      hook.result.current.send("ls\r");
      hook.result.current.resize({ cols: 80, rows: 20 });
    });
    expect(commands.sessionWrite).toHaveBeenCalledWith(3, "ls\r");
    expect(commands.sessionResize).toHaveBeenCalledWith(3, 80, 20);
  });

  it("reports the exit and restarts on request", async () => {
    commands.sessionOpenLocal.mockResolvedValueOnce(ok(1)).mockResolvedValueOnce(ok(2));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("running"));
    act(() => FakeChannel.created[1]?.emit({ exitStatus: 0 }));
    expect(hook.result.current.state).toEqual({ phase: "exited", exitStatus: 0 });

    act(() => hook.result.current.restart());
    await waitFor(() => expect(hook.result.current.state).toEqual({ phase: "running", sessionId: 2 }));
  });

  it("shows a spawn failure", async () => {
    commands.sessionOpenLocal.mockResolvedValue({ status: "error", error: { code: "local_shell", message: "no shell" } });
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.state).toEqual({ phase: "error", message: "no shell" }));
  });

  it("stops the shell when the tab goes away, even if it was still starting", async () => {
    commands.sessionOpenLocal.mockResolvedValue(ok(5));
    const first = setup();
    await waitFor(() => expect(first.hook.result.current.state.phase).toBe("running"));
    first.hook.unmount();
    expect(commands.sessionClose).toHaveBeenCalledWith(5);

    let finish: (v: unknown) => void = () => {};
    commands.sessionOpenLocal.mockReturnValue(new Promise((r) => (finish = r)));
    const second = setup();
    second.hook.unmount();
    await act(async () => finish(ok(6)));
    expect(commands.sessionClose).toHaveBeenCalledWith(6);
  });
});

describe("LocalSessionView", () => {
  beforeEach(() => {
    FakeChannel.created = [];
    Object.values(commands).forEach((fn) => fn.mockReset());
  });

  it("reports status to the tab and offers a restart after the shell exits", async () => {
    commands.sessionOpenLocal.mockResolvedValueOnce(ok(1)).mockResolvedValueOnce(ok(2));
    const onStatusChange = vi.fn();
    render(<LocalSessionView onStatusChange={onStatusChange} />);
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith("connected"));

    act(() => FakeChannel.created[1]?.emit({ exitStatus: 130 }));
    expect(screen.getByRole("status")).toHaveTextContent("Shell exited (exit 130)");
    expect(onStatusChange).toHaveBeenLastCalledWith("disconnected");

    await userEvent.click(screen.getByRole("button", { name: "Restart shell" }));
    await waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith("connected"));
  });
});

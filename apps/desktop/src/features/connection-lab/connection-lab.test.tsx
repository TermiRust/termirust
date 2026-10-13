import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
vi.mock("@/features/terminal/terminal-view", () => ({
  TerminalView: forwardRef(function FakeTerminal(_props, ref) {
    useImperativeHandle(ref, () => ({
      write: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
      size: () => ({ cols: 80, rows: 24 }),
    }));
    return <div data-testid="terminal" />;
  }),
}));

const commands = {
  sessionOpenWithPassword: vi.fn(),
  sessionWrite: vi.fn(),
  sessionResize: vi.fn(),
  sessionClose: vi.fn(),
  benchmarkOutputRaw: vi.fn(),
  benchmarkOutputJson: vi.fn(),
  benchmarkAcknowledgeOutput: vi.fn(),
  sessionAcknowledgeOutput: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));

const { ConnectionLab } = await import("./connection-lab");

async function fillAndConnect(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Username"), "termirust");
  await user.type(screen.getByLabelText("Password"), "pw");
  await user.click(screen.getByRole("button", { name: "Connect" }));
}

describe("ConnectionLab", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
  });

  it("shows validation errors instead of connecting", async () => {
    const user = userEvent.setup();
    render(<ConnectionLab onExit={vi.fn()} />);
    await user.clear(screen.getByLabelText("Port"));
    await user.type(screen.getByLabelText("Port"), "99999");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(screen.getByText("Port must be 1–65535")).toBeInTheDocument();
    expect(screen.getByText("Username is required")).toBeInTheDocument();
    expect(commands.sessionOpenWithPassword).not.toHaveBeenCalled();
  });

  it("asks the user to verify an unknown host key and connects after trusting it", async () => {
    commands.sessionOpenWithPassword
      .mockResolvedValueOnce({
        status: "ok",
        data: { status: "hostKeyNeedsConfirmation", algorithm: "ssh-ed25519", fingerprint: "SHA256:zzz" },
      })
      .mockResolvedValueOnce({ status: "ok", data: { status: "opened", sessionId: 1 } });
    const user = userEvent.setup();
    render(<ConnectionLab onExit={vi.fn()} />);

    await fillAndConnect(user);
    const dialog = await screen.findByRole("alertdialog", { name: "Verify host key" });
    expect(dialog).toHaveTextContent("ssh-ed25519 SHA256:zzz");

    await user.click(screen.getByRole("button", { name: "Trust & connect" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Connected");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the error returned by the backend", async () => {
    commands.sessionOpenWithPassword.mockResolvedValue({
      status: "error",
      error: { code: "unreachable", message: "could not reach 127.0.0.1:2222: connection refused" },
    });
    const user = userEvent.setup();
    render(<ConnectionLab onExit={vi.fn()} />);

    await fillAndConnect(user);
    expect(await screen.findByRole("status")).toHaveTextContent("connection refused");
  });

  it("lists a benchmark result", async () => {
    commands.benchmarkOutputRaw.mockResolvedValue({ status: "ok", data: { totalBytes: 0, messages: 0, rustElapsedMs: 1 } });
    const user = userEvent.setup();
    render(<ConnectionLab onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Benchmark raw" }));
    expect(await screen.findByRole("list", { name: "Benchmark results" })).toHaveTextContent(/^RAW: 0 MB/);
  });

  it("calls onExit from the back button", async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionLab onExit={onExit} />);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onExit).toHaveBeenCalledOnce();
  });
});

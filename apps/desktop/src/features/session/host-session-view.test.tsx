import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeChannel } from "@/test/tauri-channel-mock";

import type { HostView } from "@/bindings";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
vi.mock("@/features/terminal/terminal-view", () => ({
  TerminalView: forwardRef(function FakeTerminal(_props, ref) {
    useImperativeHandle(ref, () => ({ write: vi.fn(), clear: vi.fn(), focus: vi.fn(), size: () => ({ cols: 80, rows: 24 }) }));
    return <div data-testid="terminal" />;
  }),
}));

const commands = {
  sessionOpenHost: vi.fn(),
  sessionWrite: vi.fn(),
  sessionResize: vi.fn(),
  sessionClose: vi.fn(),
  sessionAcknowledgeOutput: vi.fn(),
  forwardsAutoStart: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));

const { HostSessionView } = await import("./host-session-view");
const { useAiStore } = await import("@/stores/ai-store");

const host: HostView = {
  id: "h1",
  label: "prod-api",
  hostname: "10.0.0.1",
  port: 22,
  username: null,
  auth: { method: "password", hasSavedPassword: false },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null, aiDisabled: false, os: null,
color: null,
};
const ok = (data: unknown) => ({ status: "ok", data });

describe("HostSessionView", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.sessionClose.mockResolvedValue(ok(null));
    commands.forwardsAutoStart.mockResolvedValue(ok([]));
  });

  it("prompts for username and password, remembering by default", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(ok({ status: "needsPassword", usernameRequired: true, savedPasswordRejected: false }))
      .mockResolvedValueOnce(ok({ status: "opened", sessionId: 1 }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Log in to prod-api" });
    expect(within(dialog).getByRole("checkbox", { name: /Remember in vault/ })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(within(dialog).getByText("Username is required")).toBeInTheDocument();

    await user.type(within(dialog).getByRole("textbox", { name: "Username" }), "deploy");
    await user.type(within(dialog).getByLabelText("Password"), "pw");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({
      prompted: { username: "deploy", password: "pw", passphrase: null, remember: true },
    });
  });

  it("offers an SFTP tab to the same host once connected", async () => {
    commands.sessionOpenHost.mockResolvedValue(ok({ status: "opened", sessionId: 1 }));
    const onOpenSftp = vi.fn();
    const user = userEvent.setup();
    render(<HostSessionView host={host} onOpenSftp={onOpenSftp} />);
    await user.click(await screen.findByRole("button", { name: "SFTP" }));
    expect(onOpenSftp).toHaveBeenCalledWith(host);
  });

  it("starts the host's auto-start port forwards once connected, not before", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(ok({ status: "needsPassword", usernameRequired: false, savedPasswordRejected: false }))
      .mockResolvedValueOnce(ok({ status: "opened", sessionId: 1 }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Log in to prod-api" });
    expect(commands.forwardsAutoStart).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("Password"), "pw");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    await screen.findByRole("button", { name: "Disconnect" });
    expect(commands.forwardsAutoStart).toHaveBeenCalledExactlyOnceWith("h1");
  });

  it("offers AI only when it is on and the host did not opt out", async () => {
    commands.sessionOpenHost.mockResolvedValue(ok({ status: "opened", sessionId: 1 }));
    const enabled = { enabled: true, kind: "anthropic" as const, baseUrl: "", model: "", hasApiKey: true };
    useAiStore.setState({ settings: { ...enabled, enabled: false } });
    const { unmount } = render(<HostSessionView host={host} />);
    await screen.findByRole("button", { name: "Disconnect" });
    expect(screen.queryByRole("button", { name: "AI" })).not.toBeInTheDocument();
    unmount();

    useAiStore.setState({ settings: enabled });
    const user = userEvent.setup();
    const second = render(<HostSessionView host={host} />);
    await user.click(await screen.findByRole("button", { name: "AI" }));
    expect(screen.getByRole("dialog", { name: "Ask AI for a command" })).toBeInTheDocument();
    second.unmount();

    render(<HostSessionView host={{ ...host, aiDisabled: true }} />);
    await screen.findByRole("button", { name: "Disconnect" });
    expect(screen.queryByRole("button", { name: "AI" })).not.toBeInTheDocument();
    useAiStore.setState({ settings: null });
  });

  it("explains when the saved password was rejected", async () => {
    commands.sessionOpenHost.mockResolvedValue(ok({ status: "needsPassword", usernameRequired: false, savedPasswordRejected: true }));
    render(<HostSessionView host={host} />);
    expect(await screen.findByText(/saved password was rejected/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Username" })).not.toBeInTheDocument();
  });

  it("unlocks an encrypted key and says when the passphrase was wrong", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(ok({ status: "needsPassphrase", keyLabel: "laptop", wrongPassphrase: true, usernameRequired: false }))
      .mockResolvedValueOnce(ok({ status: "opened", sessionId: 4 }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Unlock “laptop”" });
    expect(dialog).toHaveTextContent("That passphrase is not correct");
    expect(within(dialog).queryByRole("textbox", { name: "Username" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Passphrase"), "pp");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({
      prompted: { username: null, password: null, passphrase: "pp", remember: true },
    });
  });

  it("asks only for a username for agent and key logins", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(ok({ status: "needsUsername" }))
      .mockResolvedValueOnce(ok({ status: "opened", sessionId: 5 }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Username for prod-api" });
    expect(within(dialog).queryByLabelText("Password")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Username" }), "git");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({
      prompted: { username: "git", password: null, passphrase: null, remember: false },
    });
  });

  it("asks to verify a new server key", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(ok({ status: "hostKeyUnknown", server: "prod (10.0.0.1:22)", algorithm: "ssh-ed25519", fingerprint: "SHA256:abc" }))
      .mockResolvedValueOnce(ok({ status: "opened", sessionId: 2 }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Verify new server" });
    expect(dialog).toHaveTextContent("SHA256:abc");
    expect(dialog).toHaveTextContent("prod (10.0.0.1:22)");
    await user.click(within(dialog).getByRole("button", { name: "Trust & connect" }));
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({ confirmedFingerprint: "SHA256:abc" });
  });

  it("warns loudly about a changed key and makes Cancel the default", async () => {
    commands.sessionOpenHost.mockResolvedValue(
      ok({ status: "hostKeyChanged", server: "prod (10.0.0.1:22)", algorithm: "ssh-ed25519", fingerprint: "SHA256:new", previousFingerprint: "SHA256:old" }),
    );
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Host key has changed" });
    expect(dialog).toHaveTextContent("SHA256:old");
    expect(dialog).toHaveTextContent("SHA256:new");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "I understand, update the key" })).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Not connected");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("updates a changed key only after the user confirms they verified it", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(
        ok({ status: "hostKeyChanged", server: "prod (10.0.0.1:22)", algorithm: "ssh-ed25519", fingerprint: "SHA256:new", previousFingerprint: "SHA256:old" }),
      )
      .mockResolvedValueOnce(ok({ status: "opened", sessionId: 12 }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);
    const dialog = await screen.findByRole("dialog", { name: "Host key has changed" });

    await user.click(within(dialog).getByRole("checkbox", { name: /verified the new fingerprint/ }));
    await user.click(within(dialog).getByRole("button", { name: "I understand, update the key" }));
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({ confirmedFingerprint: "SHA256:new", rememberHostKey: true });
  });

  it("connects once without saving a new key", async () => {
    commands.sessionOpenHost
      .mockResolvedValueOnce(ok({ status: "hostKeyUnknown", server: "prod (10.0.0.1:22)", algorithm: "ssh-ed25519", fingerprint: "SHA256:abc" }))
      .mockResolvedValueOnce(ok({ status: "opened", sessionId: 13 }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);
    await user.click(await screen.findByRole("button", { name: "Connect once without saving" }));
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({ confirmedFingerprint: "SHA256:abc", rememberHostKey: false });
  });

  it("copies the fingerprint", async () => {
    commands.sessionOpenHost.mockResolvedValue(ok({ status: "hostKeyUnknown", server: "s", algorithm: "ssh-ed25519", fingerprint: "SHA256:copyme" }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);
    await user.click(await screen.findByRole("button", { name: /Copy fingerprint/ }));
    expect(await navigator.clipboard.readText()).toBe("SHA256:copyme");
  });

  it("reports its connection status for the tab", async () => {
    commands.sessionOpenHost.mockResolvedValue(ok({ status: "opened", sessionId: 3 }));
    const onStatusChange = vi.fn();
    render(<HostSessionView host={host} onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenCalledWith("connecting");
    await vi.waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith("connected"));
  });

  it("reports an error status when the backend refuses", async () => {
    commands.sessionOpenHost.mockResolvedValue({ status: "error", error: { code: "invalid_data", message: "agent not supported" } });
    const onStatusChange = vi.fn();
    render(<HostSessionView host={host} onStatusChange={onStatusChange} />);
    await vi.waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith("error"));
    expect(screen.getByRole("status")).toHaveTextContent("agent not supported");
  });

  describe("after the connection is lost", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      FakeChannel.created = [];
    });
    afterEach(() => vi.useRealTimers());

    it("dims the terminal, counts down and reconnects on its own", async () => {
      commands.sessionOpenHost
        .mockResolvedValueOnce(ok({ status: "opened", sessionId: 7 }))
        .mockResolvedValueOnce(ok({ status: "opened", sessionId: 8 }));
      const onStatusChange = vi.fn();
      render(<HostSessionView host={host} onStatusChange={onStatusChange} />);
      await vi.waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith("connected"));

      act(() => FakeChannel.created[1]?.emit({ exitStatus: null }));
      expect(await screen.findByRole("status")).toHaveTextContent(/Reconnecting in [45]s \(attempt 1 of 3\)/);
      expect(onStatusChange).toHaveBeenLastCalledWith("disconnected");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5500);
      });
      await vi.waitFor(() => expect(commands.sessionOpenHost).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith("connected"));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("does not reconnect after the user cancels", async () => {
      commands.sessionOpenHost.mockResolvedValue(ok({ status: "opened", sessionId: 9 }));
      render(<HostSessionView host={host} />);
      await screen.findByRole("button", { name: "Disconnect" });
      act(() => FakeChannel.created[1]?.emit({ exitStatus: null }));

      await act(async () => {
        screen.getByRole("button", { name: "Cancel" }).click();
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(commands.sessionOpenHost).toHaveBeenCalledOnce();
      expect(screen.getByRole("status")).toHaveTextContent("Connection lost.");
    });
  });
});

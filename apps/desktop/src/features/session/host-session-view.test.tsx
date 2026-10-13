import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
};
vi.mock("@/bindings", () => ({ commands }));

const { HostSessionView } = await import("./host-session-view");

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
  keepaliveSecs: null,
};
const ok = (data: unknown) => ({ status: "ok", data });

describe("HostSessionView", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.sessionClose.mockResolvedValue(ok(null));
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

    expect(await screen.findByRole("status")).toHaveTextContent("Connected");
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({
      prompted: { username: "deploy", password: "pw", passphrase: null, remember: true },
    });
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
      .mockResolvedValueOnce(ok({ status: "hostKeyUnknown", algorithm: "ssh-ed25519", fingerprint: "SHA256:abc" }))
      .mockResolvedValueOnce(ok({ status: "opened", sessionId: 2 }));
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Verify new server" });
    expect(dialog).toHaveTextContent("SHA256:abc");
    await user.click(within(dialog).getByRole("button", { name: "Trust & connect" }));
    expect(commands.sessionOpenHost.mock.calls[1]?.[0]).toMatchObject({ confirmedFingerprint: "SHA256:abc" });
  });

  it("warns loudly about a changed key and makes Cancel the default", async () => {
    commands.sessionOpenHost.mockResolvedValue(
      ok({ status: "hostKeyChanged", algorithm: "ssh-ed25519", fingerprint: "SHA256:new", previousFingerprint: "SHA256:old" }),
    );
    const user = userEvent.setup();
    render(<HostSessionView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Host key has changed" });
    expect(dialog).toHaveTextContent("Previous: SHA256:old");
    expect(dialog).toHaveTextContent("Now: SHA256:new");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Not connected");
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
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
});

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ForwardRuleView, HostView } from "@/bindings";

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

const { ForwardsView, STATUS_POLL_MS } = await import("./forwards-view");
const { useForwardsStore } = await import("@/stores/forwards-store");
const { useHostsStore } = await import("@/stores/hosts-store");

const ok = (data: unknown) => ({ status: "ok", data });
const host: HostView = {
  id: "h1",
  label: "bastion",
  hostname: "10.0.0.1",
  port: 22,
  username: "deploy",
  auth: { method: "password", hasSavedPassword: false },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null, aiDisabled: false, os: null, environment: null,
  color: null,
};
const dbRule: ForwardRuleView = {
  id: "r1",
  label: "Postgres",
  hostId: "h1",
  spec: { kind: "local", bindHost: "127.0.0.1", bindPort: 15432, targetHost: "db", targetPort: 5432 },
  autoStart: true,
  summary: "-L 127.0.0.1:15432:db:5432",
};
const initialForwards = useForwardsStore.getState();
const row = (label: string) => screen.getByRole("listitem", { name: label });

describe("ForwardsView", () => {
  beforeEach(() => {
    useForwardsStore.setState(initialForwards, true);
    useHostsStore.setState({ hosts: [host], groups: [], loaded: true, error: null });
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.forwardsList.mockResolvedValue(ok([dbRule]));
    commands.forwardsStatus.mockResolvedValue(ok([]));
    commands.forwardsStop.mockResolvedValue(ok(null));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("explains the empty state", async () => {
    commands.forwardsList.mockResolvedValue(ok([]));
    render(<ForwardsView />);
    expect(await screen.findByText("No port forwards yet")).toBeInTheDocument();
  });

  it("lists rules with their host, flag and auto start", async () => {
    render(<ForwardsView />);
    const item = await screen.findByRole("listitem", { name: "Postgres" });
    expect(item).toHaveTextContent("-L 127.0.0.1:15432:db:5432 · via bastion");
    expect(item).toHaveTextContent("auto start");
    expect(within(item).getByLabelText("Status: stopped")).toBeInTheDocument();
  });

  it("starts a rule and shows where it listens and how many connections it carries", async () => {
    commands.forwardsStart.mockResolvedValue(
      ok({ status: "started", state: { state: "running", listeningOn: "127.0.0.1:15432", active: 0, total: 0 } }),
    );
    const user = userEvent.setup();
    render(<ForwardsView />);
    await user.click(await screen.findByRole("button", { name: "Start Postgres" }));

    expect(commands.forwardsStart).toHaveBeenCalledWith({ ruleId: "r1", prompted: null, confirmedFingerprint: null, rememberHostKey: true });
    expect(within(row("Postgres")).getByText("127.0.0.1:15432")).toBeInTheDocument();
    expect(within(row("Postgres")).getByLabelText("Status: running")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop Postgres" }));
    expect(commands.forwardsStop).toHaveBeenCalledWith("r1");
    expect(await screen.findByRole("button", { name: "Start Postgres" })).toBeInTheDocument();
  });

  it("shows why a rule failed", async () => {
    commands.forwardsStart.mockResolvedValue(ok({ status: "started", state: { state: "failed", message: "127.0.0.1:15432 is already in use" } }));
    const user = userEvent.setup();
    render(<ForwardsView />);
    await user.click(await screen.findByRole("button", { name: "Start Postgres" }));
    expect(within(row("Postgres")).getByRole("alert")).toHaveTextContent("127.0.0.1:15432 is already in use");
  });

  it("refreshes live counts while the screen is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ForwardsView />);
    await screen.findByRole("listitem", { name: "Postgres" });
    commands.forwardsStatus.mockResolvedValue(
      ok([{ ruleId: "r1", state: { state: "running", listeningOn: "127.0.0.1:15432", active: 3, total: 9 } }]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_POLL_MS);
    });
    expect(within(row("Postgres")).getByText("3 open · 9 total")).toBeInTheDocument();
  });

  it("asks for a password, then retries with it", async () => {
    commands.forwardsStart
      .mockResolvedValueOnce(ok({ status: "needsInput", prompt: { status: "needsPassword", usernameRequired: false, savedPasswordRejected: false } }))
      .mockResolvedValueOnce(ok({ status: "started", state: { state: "running", listeningOn: "127.0.0.1:15432", active: 0, total: 0 } }));
    const user = userEvent.setup();
    render(<ForwardsView />);
    await user.click(await screen.findByRole("button", { name: "Start Postgres" }));

    const dialog = await screen.findByRole("dialog", { name: "Log in to bastion" });
    await user.type(within(dialog).getByLabelText("Password"), "pw");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    expect(commands.forwardsStart.mock.calls[1]?.[0]).toMatchObject({ prompted: { password: "pw", remember: true } });
    expect(await within(row("Postgres")).findByLabelText("Status: running")).toBeInTheDocument();
  });

  it("asks to confirm an unknown host key, then retries trusting it", async () => {
    commands.forwardsStart
      .mockResolvedValueOnce(ok({ status: "needsInput", prompt: { status: "hostKeyUnknown", server: "10.0.0.1:22", algorithm: "ssh-ed25519", fingerprint: "SHA256:abc" } }))
      .mockResolvedValueOnce(ok({ status: "started", state: { state: "running", listeningOn: "127.0.0.1:15432", active: 0, total: 0 } }));
    const user = userEvent.setup();
    render(<ForwardsView />);
    await user.click(await screen.findByRole("button", { name: "Start Postgres" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Trust & connect" }));
    expect(commands.forwardsStart.mock.calls[1]?.[0]).toMatchObject({ confirmedFingerprint: "SHA256:abc", rememberHostKey: true });
  });

  it("creates a rule, validating ports and warning about network-wide listeners", async () => {
    commands.forwardsList.mockResolvedValue(ok([]));
    commands.forwardsCreate.mockResolvedValue(ok({ ...dbRule, id: "r2", label: "-D 127.0.0.1:1080", spec: { kind: "dynamic", bindHost: "127.0.0.1", bindPort: 1080 } }));
    const user = userEvent.setup();
    render(<ForwardsView />);
    await user.click(await screen.findByRole("button", { name: "New rule" }));
    const dialog = await screen.findByRole("dialog", { name: "New port forward" });
    expect(within(dialog).getByRole("combobox", { name: "Through host" })).toHaveValue("h1");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getAllByText("1–65535").length).toBeGreaterThan(0);
    expect(commands.forwardsCreate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("radio", { name: "SOCKS proxy" }));
    expect(within(dialog).queryByRole("textbox", { name: "Destination host" })).not.toBeInTheDocument();
    const address = within(dialog).getByRole("textbox", { name: "Listen address" });
    await user.clear(address);
    await user.type(address, "0.0.0.0");
    expect(within(dialog).getByRole("note")).toHaveTextContent(/Other machines on your network/);
    await user.clear(address);
    await user.type(address, "127.0.0.1");
    expect(within(dialog).queryByRole("note")).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Listen port" }), "1080");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(commands.forwardsCreate).toHaveBeenCalledWith({
      label: "",
      hostId: "h1",
      spec: { kind: "dynamic", bindHost: "127.0.0.1", bindPort: 1080 },
      autoStart: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("listitem", { name: "-D 127.0.0.1:1080" })).toBeInTheDocument();
  });

  it("edits a rule with its saved values and shows server-side errors", async () => {
    commands.forwardsUpdate.mockResolvedValue({ status: "error", error: { code: "invalid_data", message: "destination host must not contain spaces" } });
    const user = userEvent.setup();
    render(<ForwardsView />);
    await user.click(await screen.findByRole("button", { name: "Edit Postgres" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Postgres" });
    expect(within(dialog).getByRole("textbox", { name: "Destination host" })).toHaveValue("db");
    expect(within(dialog).getByRole("checkbox", { name: /Start automatically/ })).toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(commands.forwardsUpdate).toHaveBeenCalledWith("r1", expect.objectContaining({ label: "Postgres", autoStart: true }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("must not contain spaces");
  });

  it("deletes a rule after confirmation", async () => {
    commands.forwardsDelete.mockResolvedValue(ok(null));
    const user = userEvent.setup();
    render(<ForwardsView />);
    await user.click(await screen.findByRole("button", { name: "Delete Postgres" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Postgres?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(commands.forwardsDelete).toHaveBeenCalledWith("r1");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Postgres" })).not.toBeInTheDocument());
  });
});

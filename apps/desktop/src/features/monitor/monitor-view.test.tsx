import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostStatsDto, HostView } from "@/bindings";

const commands = { monitorProbe: vi.fn(), monitorForget: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { MonitorView } = await import("./monitor-view");
const { REFRESH_MS } = await import("./use-host-stats");
const { useHostsStore } = await import("@/stores/hosts-store");

const ok = <T,>(data: T) => ({ status: "ok", data });
const host = (id: string, overrides: Partial<HostView> = {}): HostView => ({
  id,
  label: id,
  hostname: `${id}.internal`,
  port: 22,
  username: "deploy",
  auth: { method: "agent" },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null,
  color: null,
  aiDisabled: false,
  os: null,
  environment: null,
  ...overrides,
});
const stats = (overrides: Partial<HostStatsDto> = {}): HostStatsDto => ({
  osId: "ubuntu",
  osName: "Ubuntu 24.04.1 LTS",
  kernel: "Linux 6.8.0-45-generic x86_64",
  hostname: "web-1",
  uptimeSecs: 356_400,
  load: [0.42, 0.31, 0.25],
  cpuCount: 4,
  cpuPercent: 30,
  memTotalKb: 8_000_000,
  memAvailableKb: 2_000_000,
  swapTotalKb: 0,
  swapFreeKb: 0,
  diskTotalKb: 51_475_068,
  diskUsedKb: 47_000_000,
  diskMount: "/",
  addresses: ["10.0.1.12"],
  topProcesses: [{ cpuPercent: 12.5, memPercent: 3.1, command: "postgres" }],
  ...overrides,
});
const live = (s = stats()) => ok({ status: "stats", stats: s });

describe("MonitorView", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.monitorForget.mockResolvedValue(ok(null));
    commands.monitorProbe.mockResolvedValue(live());
    useHostsStore.setState({ hosts: [host("web", { environment: "production" }), host("db")], groups: [], loaded: true, error: null });
  });
  afterEach(() => vi.useRealTimers());

  it("starts with the host picker and shows a card with CPU, memory, disk and processes for a chosen host", async () => {
    const user = userEvent.setup();
    render(<MonitorView />);
    expect(screen.getByText(/Choose one or more hosts/)).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Hosts to monitor" })).getByRole("button", { name: /web/ }));

    const card = within(await screen.findByRole("article", { name: "Monitor web" }));
    expect(commands.monitorProbe).toHaveBeenCalledWith({ hostId: "web", prompted: null, confirmedFingerprint: null, rememberHostKey: true });
    expect(await card.findByText("web-1 · 10.0.1.12")).toBeInTheDocument();
    expect(card.getByRole("meter", { name: "CPU" })).toHaveAttribute("aria-valuenow", "30");
    expect(card.getByText("4 cores · load 0.42 · 0.31 · 0.25")).toBeInTheDocument();
    expect(card.getByRole("meter", { name: "Memory" })).toHaveAttribute("aria-valuenow", "75");
    expect(card.getByText("5.7 GB / 7.6 GB")).toBeInTheDocument();
    expect(card.queryByText(/swap/)).not.toBeInTheDocument();
    expect(card.getByRole("meter", { name: "Disk /" })).toHaveAttribute("aria-valuenow", "91");
    expect(within(card.getByRole("table", { name: "Top processes" })).getByText("postgres")).toBeInTheDocument();
    expect(card.getByText("up 4d 3h")).toBeInTheDocument();
    expect(card.getByText("Ubuntu 24.04.1 LTS")).toBeInTheDocument();
    expect(card.getByText("PROD")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("termirust.monitor.hosts") ?? "[]")).toEqual(["web"]);
  });

  it("remembers the chosen hosts and stops watching one, closing its connection", async () => {
    localStorage.setItem("termirust.monitor.hosts", JSON.stringify(["db", "gone", "web"]));
    const user = userEvent.setup();
    render(<MonitorView />);
    expect(screen.queryByRole("group", { name: "Hosts to monitor" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Monitor db", "Monitor web"]);

    await user.click(screen.getByRole("button", { name: "Stop monitoring db" }));
    expect(screen.queryByRole("article", { name: "Monitor db" })).not.toBeInTheDocument();
    expect(commands.monitorForget).toHaveBeenCalledWith("db");
    expect(JSON.parse(localStorage.getItem("termirust.monitor.hosts") ?? "[]")).toEqual(["gone", "web"]);
  });

  it("refreshes every 10 seconds and on demand", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem("termirust.monitor.hosts", JSON.stringify(["web"]));
    render(<MonitorView />);
    const card = within(await screen.findByRole("article", { name: "Monitor web" }));
    await card.findByText("web-1 · 10.0.1.12");
    commands.monitorProbe.mockResolvedValue(live(stats({ cpuPercent: 80 })));
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS));
    expect(commands.monitorProbe).toHaveBeenCalledTimes(2);
    expect(card.getByRole("meter", { name: "CPU" })).toHaveAttribute("aria-valuenow", "80");

    await act(async () => card.getByRole("button", { name: "Refresh web" }).click());
    expect(commands.monitorProbe).toHaveBeenCalledTimes(3);
  });

  it("asks for a password, sends it once, then keeps polling without it", async () => {
    localStorage.setItem("termirust.monitor.hosts", JSON.stringify(["web"]));
    commands.monitorProbe.mockResolvedValueOnce(ok({ status: "needsInput", prompt: { status: "needsPassword", usernameRequired: false, savedPasswordRejected: false } }));
    const user = userEvent.setup();
    render(<MonitorView />);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Password"), "pw");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(commands.monitorProbe).toHaveBeenLastCalledWith({
      hostId: "web",
      prompted: { username: null, password: "pw", passphrase: null, remember: true },
      confirmedFingerprint: null,
      rememberHostKey: true,
    });
    const card = within(screen.getByRole("article", { name: "Monitor web" }));
    await card.findByText("web-1 · 10.0.1.12");

    await user.click(card.getByRole("button", { name: "Refresh web" }));
    expect(commands.monitorProbe).toHaveBeenLastCalledWith({ hostId: "web", prompted: null, confirmedFingerprint: null, rememberHostKey: true });
  });

  it("offers Log in after a cancelled prompt and Try again after a failure", async () => {
    localStorage.setItem("termirust.monitor.hosts", JSON.stringify(["web"]));
    commands.monitorProbe
      .mockResolvedValueOnce(ok({ status: "needsInput", prompt: { status: "needsUsername" } }))
      .mockResolvedValueOnce({ status: "error", error: { kind: "ssh", message: "connection refused" } });
    const user = userEvent.setup();
    render(<MonitorView />);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    const card = within(screen.getByRole("article", { name: "Monitor web" }));
    await user.click(card.getByRole("button", { name: "Log in" }));
    expect(await card.findByRole("alert")).toHaveTextContent("connection refused");
    await user.click(card.getByRole("button", { name: "Try again" }));
    expect(await card.findByText("web-1 · 10.0.1.12")).toBeInTheDocument();
  });
});

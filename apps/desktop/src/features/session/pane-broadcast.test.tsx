import { act, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostView } from "@/bindings";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));

type Props = { onData?: (d: string) => void; forcePasteConfirmation?: boolean };
/** Latest props of each mounted terminal, in mount order. */
const terminals = new Map<object, Props>();
vi.mock("@/features/terminal/terminal-view", () => ({
  TerminalView: forwardRef(function FakeTerminal(props: Props, ref) {
    const instance = useRef({});
    terminals.set(instance.current, props);
    useImperativeHandle(ref, () => ({ write: vi.fn(), clear: vi.fn(), focus: vi.fn(), selection: () => "", size: () => ({ cols: 80, rows: 24 }) }));
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

const host: HostView = {
  id: "h1",
  label: "web",
  hostname: "10.0.0.1",
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
};
const ok = (data: unknown) => ({ status: "ok", data });
const latestProps = (index: number) => [...terminals.values()][index]!;

describe("broadcast input across panes", () => {
  beforeEach(() => {
    terminals.clear();
    Object.values(commands).forEach((fn) => fn.mockReset());
    let session = 0;
    commands.sessionOpenHost.mockImplementation(async () => ok({ status: "opened", sessionId: ++session }));
    commands.sessionClose.mockResolvedValue(ok(null));
    commands.forwardsAutoStart.mockResolvedValue(ok([]));
  });

  async function renderPanes(broadcast: boolean) {
    const view = render(
      <>
        <HostSessionView host={host} tabId="t1" paneId="p1" broadcast={broadcast} focused />
        <HostSessionView host={host} tabId="t1" paneId="p2" broadcast={broadcast} focused={false} />
      </>,
    );
    expect(await screen.findAllByRole("button", { name: "Disconnect" })).toHaveLength(2);
    // The DOM can show "connected" before the panes' input-registration effects have run.
    await act(async () => {});
    return view;
  }

  it("sends what is typed in one pane to every pane while broadcasting", async () => {
    await renderPanes(true);
    act(() => latestProps(0).onData?.("uptime\r"));
    expect(commands.sessionWrite.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
    expect(latestProps(0).forcePasteConfirmation).toBe(true);
  });

  it("types only into its own session otherwise", async () => {
    await renderPanes(false);
    act(() => latestProps(0).onData?.("ls\r"));
    expect(commands.sessionWrite).toHaveBeenCalledTimes(1);
    expect(latestProps(0).forcePasteConfirmation).toBe(false);
  });
});

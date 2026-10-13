import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConnectionBanner } from "./connection-banner";
import type { AutoReconnect } from "./use-auto-reconnect";
import type { HostSessionState } from "./use-host-session";

const auto = (overrides: Partial<AutoReconnect> = {}): AutoReconnect => ({
  secondsLeft: null,
  attempt: 1,
  attemptsLeft: 3,
  cancel: vi.fn(),
  retryNow: vi.fn(),
  ...overrides,
});

function show(state: HostSessionState, recovering = false, a = auto()) {
  const onReconnect = vi.fn();
  const view = render(<ConnectionBanner state={state} recovering={recovering} auto={a} onReconnect={onReconnect} />);
  return { onReconnect, view, user: userEvent.setup() };
}

describe("ConnectionBanner", () => {
  it("stays hidden while connected, connecting for the first time, or asking for input", () => {
    for (const state of [
      { phase: "connected", sessionId: 1 },
      { phase: "connecting" },
      { phase: "needsUsername" },
    ] as HostSessionState[]) {
      const { view } = show(state);
      expect(view.container).toBeEmptyDOMElement();
      view.unmount();
    }
  });

  it("counts down to the next attempt with reconnect-now and cancel", async () => {
    const a = auto({ secondsLeft: 4, attempt: 2, attemptsLeft: 2 });
    const { user } = show({ phase: "closed", reason: "lost", exitStatus: null }, true, a);
    expect(screen.getByRole("status")).toHaveTextContent("Connection lost. Reconnecting in 4s (attempt 2 of 3)");
    await user.click(screen.getByRole("button", { name: "Reconnect now" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(a.retryNow).toHaveBeenCalledOnce();
    expect(a.cancel).toHaveBeenCalledOnce();
  });

  it("says it is reconnecting while an attempt is in flight", () => {
    show({ phase: "connecting" }, true);
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers a manual reconnect once automatic attempts are over", async () => {
    const { onReconnect, user } = show({ phase: "closed", reason: "lost", exitStatus: null }, true);
    expect(screen.getByRole("status")).toHaveTextContent("Connection lost.");
    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it.each([
    [{ phase: "closed", reason: "exited", exitStatus: 0 }, false, "Session ended (exit 0)"],
    [{ phase: "closed", reason: "disconnected", exitStatus: null }, false, "Disconnected"],
    [{ phase: "cancelled" }, false, "Not connected"],
    [{ phase: "error", message: "timed out" }, false, "timed out"],
    [{ phase: "error", message: "timed out" }, true, "Still unreachable: timed out"],
  ] as [HostSessionState, boolean, string][])("%j", (state, recovering, text) => {
    show(state, recovering);
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });
});

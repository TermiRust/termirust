import { describe, expect, it, vi } from "vitest";

import { broadcastToTab, canSendToTerminal, forgetPendingInput, registerPaneInput, registerTerminalInput, sendToTerminal, sendWhenReady } from "./terminal-inputs";

describe("terminal inputs", () => {
  it("routes text to the registered tab until it unregisters", () => {
    const send = vi.fn();
    const unregister = registerTerminalInput("t1", send);
    expect(canSendToTerminal("t1")).toBe(true);
    expect(sendToTerminal("t1", "ls\r")).toBe(true);
    expect(send).toHaveBeenCalledWith("ls\r");

    unregister();
    expect(canSendToTerminal("t1")).toBe(false);
    expect(sendToTerminal("t1", "ls")).toBe(false);
    expect(canSendToTerminal(null)).toBe(false);
  });

  it("does not let a stale unregister remove a newer session", () => {
    const old = registerTerminalInput("t2", vi.fn());
    const fresh = vi.fn();
    registerTerminalInput("t2", fresh);
    old();
    sendToTerminal("t2", "x");
    expect(fresh).toHaveBeenCalledWith("x");
  });

  it("holds text for a tab until it connects, then sends it once", () => {
    sendWhenReady("t3", "uptime\r");
    const send = vi.fn();
    const unregister = registerTerminalInput("t3", send);
    expect(send).toHaveBeenCalledExactlyOnceWith("uptime\r");
    unregister();
    registerTerminalInput("t3", send)();
    expect(send).toHaveBeenCalledTimes(1);

    const live = vi.fn();
    registerTerminalInput("t4", live);
    sendWhenReady("t4", "now");
    expect(live).toHaveBeenCalledWith("now");
  });

  it("forgets text for tabs closed before connecting", () => {
    sendWhenReady("t5", "x");
    forgetPendingInput("t5");
    const send = vi.fn();
    registerTerminalInput("t5", send);
    expect(send).not.toHaveBeenCalled();
  });

  it("broadcasts to every registered pane of one tab only", () => {
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    const stopA = registerPaneInput("tb", "pa", a);
    registerPaneInput("tb", "pb", b);
    registerPaneInput("tc", "px", other);
    expect(broadcastToTab("tb", "ls\r")).toBe(2);
    expect(a).toHaveBeenCalledWith("ls\r");
    expect(b).toHaveBeenCalledWith("ls\r");
    expect(other).not.toHaveBeenCalled();

    stopA();
    expect(broadcastToTab("tb", "x")).toBe(1);
    expect(broadcastToTab("none", "x")).toBe(0);
  });
});

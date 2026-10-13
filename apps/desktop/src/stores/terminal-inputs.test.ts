import { describe, expect, it, vi } from "vitest";

import { canSendToTerminal, registerTerminalInput, sendToTerminal } from "./terminal-inputs";

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
});

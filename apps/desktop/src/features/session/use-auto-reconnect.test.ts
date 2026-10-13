import { describe, expect, it } from "vitest";

import { initialReconnectState, RECONNECT_SCHEDULE, reconnectReducer, secondsUntilRetry, type ReconnectState } from "./use-auto-reconnect";

const tick = (state: ReconnectState, now: number) => reconnectReducer(state, { type: "tick", now });

describe("reconnectReducer", () => {
  it("arms on the first tick and fires when the delay has passed", () => {
    let s = tick(initialReconnectState(0), 1000);
    expect(s.deadline).toBe(1000 + RECONNECT_SCHEDULE[0] * 1000);
    expect(secondsUntilRetry(s, true)).toBe(5);

    s = tick(s, 3500);
    expect(secondsUntilRetry(s, true)).toBe(3);
    expect(s.fired).toBe(0);

    s = tick(s, 6000);
    expect(s).toMatchObject({ attempts: 1, deadline: null, fired: 1 });
  });

  it("follows the 5s, 10s, 20s schedule and then stops", () => {
    let s = initialReconnectState(0);
    let now = 0;
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      s = tick(s, now);
      if (s.deadline === null) break;
      waits.push((s.deadline - now) / 1000);
      now = s.deadline;
      s = tick(s, now);
    }
    expect(waits).toEqual([5, 10, 20]);
    expect(s.attempts).toBe(3);
    expect(secondsUntilRetry(s, true)).toBeNull();
    expect(tick(s, now + 60_000).fired).toBe(3);
  });

  it("cancel stops the countdown until the next successful connection", () => {
    let s = tick(initialReconnectState(0), 0);
    s = reconnectReducer(s, { type: "cancel" });
    expect(secondsUntilRetry(s, true)).toBeNull();
    expect(tick(s, 100_000).fired).toBe(0);

    s = reconnectReducer(s, { type: "connected" });
    expect(s).toMatchObject({ cancelled: false, attempts: 0 });
  });

  it("retry now fires immediately and consumes an attempt", () => {
    const s = reconnectReducer(tick(initialReconnectState(0), 0), { type: "retryNow", now: 10 });
    expect(s).toMatchObject({ attempts: 1, fired: 1, deadline: null });
  });

  it("a successful connection resets the schedule", () => {
    let s = initialReconnectState(0);
    s = tick(tick(s, 0), 5000);
    s = reconnectReducer(s, { type: "connected" });
    expect(tick(s, 6000).deadline).toBe(6000 + RECONNECT_SCHEDULE[0] * 1000);
  });

  it("shows nothing while not waiting", () => {
    expect(secondsUntilRetry(initialReconnectState(0), false)).toBeNull();
  });
});

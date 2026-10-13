import { useCallback, useEffect, useReducer, useRef } from "react";

/** Seconds to wait before each automatic reconnect attempt. */
export const RECONNECT_SCHEDULE = [5, 10, 20] as const;

export interface ReconnectState {
  /** Attempts already started since the last successful connection. */
  attempts: number;
  /** When the next attempt fires (ms epoch), or null if none is counting down. */
  deadline: number | null;
  cancelled: boolean;
  now: number;
  /** Increments each time an attempt should start; the hook calls `retry` on change. */
  fired: number;
}

export type ReconnectAction =
  | { type: "tick"; now: number }
  | { type: "cancel" }
  | { type: "retryNow"; now: number }
  | { type: "connected" };

export const initialReconnectState = (now: number): ReconnectState => ({ attempts: 0, deadline: null, cancelled: false, now, fired: 0 });

export function reconnectReducer(state: ReconnectState, action: ReconnectAction): ReconnectState {
  switch (action.type) {
    case "connected":
      return { ...state, attempts: 0, deadline: null, cancelled: false };
    case "cancel":
      return { ...state, cancelled: true, deadline: null };
    case "retryNow":
      return { ...state, attempts: state.attempts + 1, deadline: null, fired: state.fired + 1, now: action.now };
    case "tick": {
      if (state.cancelled || state.attempts >= RECONNECT_SCHEDULE.length) return { ...state, now: action.now };
      if (state.deadline === null) {
        const delay = RECONNECT_SCHEDULE[state.attempts] ?? 0;
        return { ...state, now: action.now, deadline: action.now + delay * 1000 };
      }
      if (action.now >= state.deadline) {
        return { ...state, now: action.now, deadline: null, attempts: state.attempts + 1, fired: state.fired + 1 };
      }
      return { ...state, now: action.now };
    }
  }
}

export interface AutoReconnect {
  /** Seconds until the next attempt, or null when nothing is scheduled. */
  secondsLeft: number | null;
  /** 1-based number of the next attempt. */
  attempt: number;
  attemptsLeft: number;
  cancel: () => void;
  retryNow: () => void;
}

export function secondsUntilRetry(state: ReconnectState, waiting: boolean): number | null {
  if (!waiting || state.cancelled || state.attempts >= RECONNECT_SCHEDULE.length) return null;
  if (state.deadline === null) return RECONNECT_SCHEDULE[state.attempts] ?? null;
  return Math.max(0, Math.ceil((state.deadline - state.now) / 1000));
}

/** Counts down and calls `retry` while `waiting`; a successful connection resets the schedule. */
export function useAutoReconnect(waiting: boolean, connected: boolean, retry: () => void): AutoReconnect {
  // `now` is refreshed by the first tick before any countdown is shown.
  const [state, dispatch] = useReducer(reconnectReducer, 0, initialReconnectState);
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  });

  useEffect(() => {
    if (connected) dispatch({ type: "connected" });
  }, [connected]);

  const counting = waiting && !state.cancelled && state.attempts < RECONNECT_SCHEDULE.length;
  useEffect(() => {
    if (!counting) return;
    const tick = () => dispatch({ type: "tick", now: Date.now() });
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [counting]);

  useEffect(() => {
    if (state.fired > 0) retryRef.current();
  }, [state.fired]);

  const cancel = useCallback(() => dispatch({ type: "cancel" }), []);
  const retryNow = useCallback(() => dispatch({ type: "retryNow", now: Date.now() }), []);

  return {
    secondsLeft: secondsUntilRetry(state, waiting),
    attempt: state.attempts + 1,
    attemptsLeft: RECONNECT_SCHEDULE.length - state.attempts,
    cancel,
    retryNow,
  };
}

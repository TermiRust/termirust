import { useCallback, useEffect, useRef, useState } from "react";

import { commands, type HostStatsDto, type PromptedLogin } from "@/bindings";
import { hostPromptOf, type HostPrompt } from "@/features/session/host-prompt";

export const REFRESH_MS = 10_000;

export type HostStatsState =
  | { phase: "loading" }
  | HostPrompt
  | { phase: "cancelled" }
  | { phase: "error"; message: string }
  | { phase: "live"; stats: HostStatsDto; at: number };

interface Attempt {
  prompted: PromptedLogin | null;
  confirmedFingerprint: string | null;
  rememberHostKey: boolean;
}

/**
 * Probes a host when it appears on the Monitor screen and every 10 seconds after, keeping the
 * last snapshot while a refresh runs; the backend connection is dropped on unmount.
 */
export function useHostStats(hostId: string) {
  const [state, setState] = useState<HostStatsState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const attemptRef = useRef<Attempt>({ prompted: null, confirmedFingerprint: null, rememberHostKey: true });
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const probe = useCallback(
    async (attempt: Attempt) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      attemptRef.current = attempt;
      setRefreshing(true);
      const result = await commands.monitorProbe({ hostId, ...attempt });
      inFlightRef.current = false;
      if (!mountedRef.current) return;
      setRefreshing(false);
      if (result.status === "error") {
        setState({ phase: "error", message: result.error.message });
        return;
      }
      const outcome = result.data;
      if (outcome.status === "needsInput") {
        if (outcome.prompt.status !== "opened") setState(hostPromptOf(outcome.prompt));
        return;
      }
      // Typed secrets are only needed to log in once; the connection stays open afterwards.
      attemptRef.current = { prompted: null, confirmedFingerprint: null, rememberHostKey: true };
      setState({ phase: "live", stats: outcome.stats, at: Date.now() });
    },
    [hostId],
  );

  useEffect(() => {
    mountedRef.current = true;
    void probe(attemptRef.current);
    return () => {
      mountedRef.current = false;
      void commands.monitorForget(hostId);
    };
  }, [hostId, probe]);

  const live = state.phase === "live";
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void probe(attemptRef.current), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [live, probe]);

  const retry = useCallback((patch: Partial<Attempt>) => void probe({ ...attemptRef.current, ...patch }), [probe]);

  return {
    state,
    refreshing,
    refresh: useCallback(() => retry({}), [retry]),
    submitCredentials: useCallback((prompted: PromptedLogin) => retry({ prompted }), [retry]),
    trustHostKey: useCallback(
      (fingerprint: string, remember: boolean) => retry({ confirmedFingerprint: fingerprint, rememberHostKey: remember }),
      [retry],
    ),
    cancel: useCallback(() => setState({ phase: "cancelled" }), []),
  };
}

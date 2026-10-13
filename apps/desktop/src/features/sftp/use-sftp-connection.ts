import { useCallback, useEffect, useRef, useState } from "react";

import { commands, type HostView, type PromptedLogin } from "@/bindings";
import { hostPromptOf, type HostPrompt } from "@/features/session/host-prompt";

export type SftpConnectionState =
  | { phase: "connecting" }
  | HostPrompt
  | { phase: "connected"; sftpId: number; home: string }
  | { phase: "cancelled" }
  | { phase: "error"; message: string };

interface Attempt {
  prompted: PromptedLogin | null;
  confirmedFingerprint: string | null;
  rememberHostKey: boolean;
}

/** Opens an SFTP session to a saved host, asking for what the vault lacks, and closes it on unmount. */
export function useSftpConnection(host: HostView) {
  const [state, setState] = useState<SftpConnectionState>({ phase: "connecting" });
  const sftpIdRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const startedRef = useRef(false);
  const attemptRef = useRef<Attempt>({ prompted: null, confirmedFingerprint: null, rememberHostKey: true });

  const open = useCallback(
    async (attempt: Attempt) => {
      attemptRef.current = attempt;
      const result = await commands.sftpOpen({ hostId: host.id, ...attempt });
      if (result.status === "error") {
        setState({ phase: "error", message: result.error.message });
        return;
      }
      const outcome = result.data;
      if (outcome.status === "needsInput") {
        if (outcome.prompt.status !== "opened") setState(hostPromptOf(outcome.prompt));
        return;
      }
      if (unmountedRef.current) {
        void commands.sftpClose(outcome.sftpId);
        return;
      }
      sftpIdRef.current = outcome.sftpId;
      setState({ phase: "connected", sftpId: outcome.sftpId, home: outcome.home });
    },
    [host.id],
  );

  useEffect(() => {
    unmountedRef.current = false;
    if (!startedRef.current) {
      startedRef.current = true;
      void open(attemptRef.current);
    }
    return () => {
      unmountedRef.current = true;
      const id = sftpIdRef.current;
      if (id !== null) {
        sftpIdRef.current = null;
        void commands.sftpClose(id);
      }
    };
  }, [open]);

  const retry = useCallback(
    (patch: Partial<Attempt>) => {
      setState({ phase: "connecting" });
      void open({ ...attemptRef.current, ...patch });
    },
    [open],
  );

  return {
    state,
    submitCredentials: useCallback((prompted: PromptedLogin) => retry({ prompted }), [retry]),
    trustHostKey: useCallback(
      (fingerprint: string, remember = true) => retry({ confirmedFingerprint: fingerprint, rememberHostKey: remember }),
      [retry],
    ),
    reconnect: useCallback(() => retry({}), [retry]),
    cancel: useCallback(() => setState({ phase: "cancelled" }), []),
  };
}

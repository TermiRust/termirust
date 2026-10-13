import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { commands, type HostView, type PromptedLogin } from "@/bindings";
import type { TerminalSize } from "@/features/terminal/terminal-view";
import { toBytes } from "@/features/terminal/to-bytes";

export interface HostSessionTerminal {
  write: (data: Uint8Array, onWritten?: () => void) => void;
  size: () => TerminalSize;
}

export type HostSessionState =
  | { phase: "connecting" }
  | { phase: "needsPassword"; usernameRequired: boolean; savedPasswordRejected: boolean }
  | { phase: "needsPassphrase"; keyLabel: string; wrongPassphrase: boolean; usernameRequired: boolean }
  | { phase: "needsUsername" }
  | { phase: "hostKeyUnknown"; server: string; algorithm: string; fingerprint: string }
  | { phase: "hostKeyChanged"; server: string; algorithm: string; fingerprint: string; previousFingerprint: string }
  | { phase: "connected"; sessionId: number }
  | { phase: "closed"; exitStatus: number | null }
  | { phase: "cancelled" }
  | { phase: "error"; message: string };

interface Attempt {
  prompted: PromptedLogin | null;
  confirmedFingerprint: string | null;
}

/** Connects to a saved host as soon as the terminal is mounted; the vault supplies secrets. */
export function useHostSession(host: HostView, getTerminal: () => HostSessionTerminal | null) {
  const [state, setState] = useState<HostSessionState>({ phase: "connecting" });
  const sessionIdRef = useRef<number | null>(null);
  const unsentAckRef = useRef(0);
  const attemptRef = useRef<Attempt>({ prompted: null, confirmedFingerprint: null });
  const startedRef = useRef(false);
  const unmountedRef = useRef(false);
  // Read through a ref so a new getTerminal identity never re-runs the connect effect.
  const getTerminalRef = useRef(getTerminal);
  useLayoutEffect(() => {
    getTerminalRef.current = getTerminal;
  });

  const acknowledge = useCallback((bytes: number) => {
    const id = sessionIdRef.current;
    if (id === null) unsentAckRef.current += bytes;
    else void commands.sessionAcknowledgeOutput(id, bytes);
  }, []);

  const open = useCallback(
    async (attempt: Attempt) => {
      const terminal = getTerminalRef.current();
      if (!terminal) return;
      attemptRef.current = attempt;

      const onOutput = new Channel<number[]>();
      onOutput.onmessage = (payload) => {
        const bytes = toBytes(payload);
        terminal.write(bytes, () => acknowledge(bytes.length));
      };
      const onClosed = new Channel<{ exitStatus: number | null }>();
      onClosed.onmessage = ({ exitStatus }) => {
        sessionIdRef.current = null;
        setState({ phase: "closed", exitStatus });
      };

      const { cols, rows } = terminal.size();
      const result = await commands.sessionOpenHost(
        { hostId: host.id, cols, rows, prompted: attempt.prompted, confirmedFingerprint: attempt.confirmedFingerprint },
        onOutput,
        onClosed,
      );

      if (result.status === "error") {
        setState({ phase: "error", message: result.error.message });
        return;
      }
      const outcome = result.data;
      switch (outcome.status) {
        case "opened":
          if (unmountedRef.current) {
            void commands.sessionClose(outcome.sessionId);
            return;
          }
          sessionIdRef.current = outcome.sessionId;
          if (unsentAckRef.current > 0) {
            void commands.sessionAcknowledgeOutput(outcome.sessionId, unsentAckRef.current);
            unsentAckRef.current = 0;
          }
          setState({ phase: "connected", sessionId: outcome.sessionId });
          break;
        case "needsPassphrase":
          setState({
            phase: "needsPassphrase",
            keyLabel: outcome.keyLabel,
            wrongPassphrase: outcome.wrongPassphrase,
            usernameRequired: outcome.usernameRequired,
          });
          break;
        case "needsUsername":
          setState({ phase: "needsUsername" });
          break;
        case "needsPassword":
          setState({
            phase: "needsPassword",
            usernameRequired: outcome.usernameRequired,
            savedPasswordRejected: outcome.savedPasswordRejected,
          });
          break;
        case "hostKeyUnknown":
          setState({ phase: "hostKeyUnknown", server: outcome.server, algorithm: outcome.algorithm, fingerprint: outcome.fingerprint });
          break;
        case "hostKeyChanged":
          setState({
            phase: "hostKeyChanged",
            server: outcome.server,
            algorithm: outcome.algorithm,
            fingerprint: outcome.fingerprint,
            previousFingerprint: outcome.previousFingerprint,
          });
          break;
      }
    },
    [host.id, acknowledge],
  );

  useEffect(() => {
    unmountedRef.current = false;
    if (!startedRef.current) {
      startedRef.current = true;
      void open({ prompted: null, confirmedFingerprint: null });
    }
    return () => {
      unmountedRef.current = true;
      const id = sessionIdRef.current;
      if (id !== null) {
        sessionIdRef.current = null;
        void commands.sessionClose(id);
      }
    };
  }, [open]);

  const retry = useCallback((patch: Partial<Attempt>) => {
    setState({ phase: "connecting" });
    void open({ ...attemptRef.current, ...patch });
  }, [open]);

  const submitCredentials = useCallback((prompted: PromptedLogin) => retry({ prompted }), [retry]);
  const trustHostKey = useCallback((fingerprint: string) => retry({ confirmedFingerprint: fingerprint }), [retry]);
  const reconnect = useCallback(() => retry({}), [retry]);
  const cancel = useCallback(() => setState({ phase: "cancelled" }), []);

  const send = useCallback((data: string) => {
    const id = sessionIdRef.current;
    if (id !== null) void commands.sessionWrite(id, data);
  }, []);

  const resize = useCallback(({ cols, rows }: TerminalSize) => {
    const id = sessionIdRef.current;
    if (id !== null) void commands.sessionResize(id, cols, rows);
  }, []);

  const disconnect = useCallback(async () => {
    const id = sessionIdRef.current;
    if (id === null) return;
    sessionIdRef.current = null;
    await commands.sessionClose(id);
    setState({ phase: "closed", exitStatus: null });
  }, []);

  return { state, submitCredentials, trustHostKey, reconnect, cancel, send, resize, disconnect };
}

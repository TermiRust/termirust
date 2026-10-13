import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { commands, type HostView, type PromptedLogin } from "@/bindings";
import type { TerminalSize } from "@/features/terminal/terminal-view";
import { toBytes } from "@/features/terminal/to-bytes";

import { hostPromptOf, type HostPrompt } from "./host-prompt";

export interface HostSessionTerminal {
  write: (data: Uint8Array, onWritten?: () => void) => void;
  size: () => TerminalSize;
}

export type HostSessionState =
  | { phase: "connecting" }
  | HostPrompt
  | { phase: "connected"; sessionId: number }
  /** `lost`: the link died (no exit status); `exited`: the remote shell ended; `disconnected`: by the user. */
  | { phase: "closed"; reason: "lost" | "exited" | "disconnected"; exitStatus: number | null }
  | { phase: "cancelled" }
  | { phase: "error"; message: string };

const RECONNECTED_MARK = new TextEncoder().encode("\r\n\x1b[2m── reconnected ──\x1b[0m\r\n");

interface Attempt {
  prompted: PromptedLogin | null;
  confirmedFingerprint: string | null;
  rememberHostKey: boolean;
}

/** Connects to a saved host as soon as the terminal is mounted; the vault supplies secrets. */
export function useHostSession(host: HostView, getTerminal: () => HostSessionTerminal | null) {
  const [state, setState] = useState<HostSessionState>({ phase: "connecting" });
  // True from a lost connection until it is restored or the user gives up.
  const [recovering, setRecovering] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const sessionIdRef = useRef<number | null>(null);
  const unsentAckRef = useRef(0);
  const attemptRef = useRef<Attempt>({ prompted: null, confirmedFingerprint: null, rememberHostKey: true });
  const startedRef = useRef(false);
  const unmountedRef = useRef(false);
  const everConnectedRef = useRef(false);
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
        if (sessionIdRef.current === null) return;
        sessionIdRef.current = null;
        setRecovering(exitStatus === null);
        setState({ phase: "closed", reason: exitStatus === null ? "lost" : "exited", exitStatus });
      };

      const { cols, rows } = terminal.size();
      const result = await commands.sessionOpenHost(
        {
          hostId: host.id,
          cols,
          rows,
          prompted: attempt.prompted,
          confirmedFingerprint: attempt.confirmedFingerprint,
          rememberHostKey: attempt.rememberHostKey,
        },
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
          if (everConnectedRef.current) terminal.write(RECONNECTED_MARK);
          everConnectedRef.current = true;
          setEverConnected(true);
          setRecovering(false);
          sessionIdRef.current = outcome.sessionId;
          if (unsentAckRef.current > 0) {
            void commands.sessionAcknowledgeOutput(outcome.sessionId, unsentAckRef.current);
            unsentAckRef.current = 0;
          }
          setState({ phase: "connected", sessionId: outcome.sessionId });
          break;
        default:
          setState(hostPromptOf(outcome));
      }
    },
    [host.id, acknowledge],
  );

  useEffect(() => {
    unmountedRef.current = false;
    if (!startedRef.current) {
      startedRef.current = true;
      void open({ prompted: null, confirmedFingerprint: null, rememberHostKey: true });
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
  const trustHostKey = useCallback(
    (fingerprint: string, remember = true) => retry({ confirmedFingerprint: fingerprint, rememberHostKey: remember }),
    [retry],
  );
  const reconnect = useCallback(() => retry({}), [retry]);
  const cancel = useCallback(() => {
    setRecovering(false);
    setState({ phase: "cancelled" });
  }, []);

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
    setRecovering(false);
    setState({ phase: "closed", reason: "disconnected", exitStatus: null });
    await commands.sessionClose(id);
  }, []);

  return { state, recovering, everConnected, submitCredentials, trustHostKey, reconnect, cancel, send, resize, disconnect };
}

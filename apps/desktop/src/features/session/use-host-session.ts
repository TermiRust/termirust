import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { commands, type ConnectProgress, type HostView, type PromptedLogin } from "@/bindings";
import type { TerminalSize } from "@/features/terminal/terminal-view";
import { toBytes } from "@/features/terminal/to-bytes";

import { describeProgress, explainError, stepOf, type LogLine, type StepIndex } from "./connect-log";
import { hostPromptOf, type HostPrompt } from "./host-prompt";

/** What the step-by-step display shows for the current connection attempt. */
export interface ConnectTrace {
  lines: LogLine[];
  /** The furthest step reached. */
  step: StepIndex;
  /** The current step waits for the user (password, host key). */
  waiting: boolean;
  failed: boolean;
}

const EMPTY_TRACE: ConnectTrace = { lines: [], step: 0, waiting: false, failed: false };

const PROMPT_LINES: Record<HostPrompt["phase"], { step: StepIndex; text: string }> = {
  needsPassword: { step: 3, text: "Waiting for your password" },
  needsPassphrase: { step: 3, text: "Waiting for the key's passphrase" },
  needsUsername: { step: 3, text: "Waiting for a username" },
  hostKeyUnknown: { step: 2, text: "First connection to this server: confirm its identity" },
  hostKeyChanged: { step: 2, text: "The server's identity changed since last time: check before trusting it" },
};

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
  const [trace, setTrace] = useState<ConnectTrace>(EMPTY_TRACE);
  const sessionIdRef = useRef<number | null>(null);
  const unsentAckRef = useRef(0);
  const attemptRef = useRef<Attempt>({ prompted: null, confirmedFingerprint: null, rememberHostKey: true });
  const startedRef = useRef(false);
  const unmountedRef = useRef(false);
  const everConnectedRef = useRef(false);
  // Read through a ref so a new getTerminal identity never re-runs the connect effect.
  const getTerminalRef = useRef(getTerminal);
  // Host details are read through a ref too: a store update must not reconnect the session.
  const hostRef = useRef(host);
  useLayoutEffect(() => {
    getTerminalRef.current = getTerminal;
    hostRef.current = host;
  });

  const acknowledge = useCallback((bytes: number) => {
    const id = sessionIdRef.current;
    if (id === null) unsentAckRef.current += bytes;
    else void commands.sessionAcknowledgeOutput(id, bytes);
  }, []);

  const open = useCallback(
    async (attempt: Attempt, fresh = false) => {
      const terminal = getTerminalRef.current();
      if (!terminal) return;
      attemptRef.current = attempt;
      const add = (line: Omit<LogLine, "at">, patch: Partial<ConnectTrace> = {}) =>
        setTrace((t) => ({ ...t, ...patch, lines: [...t.lines, { ...line, at: Date.now() }] }));
      if (fresh) setTrace({ ...EMPTY_TRACE, lines: [{ at: Date.now(), level: "info", text: `Opening a session to ${hostRef.current.label}` }] });
      else setTrace((t) => ({ ...t, waiting: false, failed: false }));


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

      const onProgress = new Channel<ConnectProgress>();
      onProgress.onmessage = (progress) => {
        const step = stepOf(progress);
        setTrace((t) => ({
          ...t,
          step: (Math.max(t.step, step) as StepIndex),
          lines: [...t.lines, { ...describeProgress(progress), at: Date.now() }],
        }));
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
        onProgress,
      );

      if (result.status === "error") {
        add(explainError(result.error, hostRef.current), { failed: true });
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
          add({ level: "ok", text: "Connected" }, { step: 4 });
          setState({ phase: "connected", sessionId: outcome.sessionId });
          break;
        default: {
          const prompt = hostPromptOf(outcome);
          const line = PROMPT_LINES[prompt.phase];
          setTrace((t) => ({
            ...t,
            step: (Math.max(t.step, line.step) as StepIndex),
            waiting: true,
            lines: [...t.lines, { at: Date.now(), level: "wait", text: line.text }],
          }));
          setState(prompt);
        }
      }
    },
    [host.id, acknowledge],
  );

  useEffect(() => {
    unmountedRef.current = false;
    if (!startedRef.current) {
      startedRef.current = true;
      void open({ prompted: null, confirmedFingerprint: null, rememberHostKey: true }, true);
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

  const retry = useCallback((patch: Partial<Attempt>, fresh = false) => {
    setState({ phase: "connecting" });
    void open({ ...attemptRef.current, ...patch }, fresh);
  }, [open]);

  const submitCredentials = useCallback((prompted: PromptedLogin) => retry({ prompted }), [retry]);
  const trustHostKey = useCallback(
    (fingerprint: string, remember = true) => retry({ confirmedFingerprint: fingerprint, rememberHostKey: remember }),
    [retry],
  );
  const reconnect = useCallback(() => retry({}, true), [retry]);
  const cancel = useCallback(() => {
    setRecovering(false);
    setTrace((t) => ({ ...t, waiting: false, failed: true, lines: [...t.lines, { at: Date.now(), level: "error", text: "Cancelled" }] }));
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

  return { state, trace, recovering, everConnected, submitCredentials, trustHostKey, reconnect, cancel, send, resize, disconnect };
}

import { Channel } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";

import { commands, type PasswordSessionRequest } from "@/bindings";
import type { TerminalSize } from "@/features/terminal/terminal-view";
import { toBytes } from "@/features/terminal/to-bytes";

export type SessionLogin = Omit<PasswordSessionRequest, "cols" | "rows" | "trustedFingerprint">;

export interface SessionTerminal {
  write: (data: Uint8Array, onWritten?: () => void) => void;
  size: () => TerminalSize;
}

export type SessionState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "confirmHostKey"; algorithm: string; fingerprint: string }
  | { phase: "connected"; sessionId: number }
  | { phase: "closed"; exitStatus: number | null }
  | { phase: "error"; message: string };

const hostKeyId = (login: SessionLogin) => `${login.host}:${login.port}`;

export function useSshSession(getTerminal: () => SessionTerminal | null) {
  const [state, setState] = useState<SessionState>({ phase: "idle" });
  const sessionIdRef = useRef<number | null>(null);
  const pendingLoginRef = useRef<SessionLogin | null>(null);
  const trustedRef = useRef(new Map<string, string>());
  // Output can render before the open command returns the session id; acks wait here.
  const unsentAckRef = useRef(0);

  const acknowledge = useCallback((bytes: number) => {
    const id = sessionIdRef.current;
    if (id === null) {
      unsentAckRef.current += bytes;
      return;
    }
    void commands.sessionAcknowledgeOutput(id, bytes);
  }, []);

  const connect = useCallback(
    async (login: SessionLogin) => {
      const terminal = getTerminal();
      if (!terminal) return;
      setState({ phase: "connecting" });

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
      const result = await commands.sessionOpenWithPassword(
        { ...login, cols, rows, trustedFingerprint: trustedRef.current.get(hostKeyId(login)) ?? null },
        onOutput,
        onClosed,
      );

      if (result.status === "error") {
        setState({ phase: "error", message: result.error.message });
      } else if (result.data.status === "opened") {
        sessionIdRef.current = result.data.sessionId;
        if (unsentAckRef.current > 0) {
          void commands.sessionAcknowledgeOutput(result.data.sessionId, unsentAckRef.current);
          unsentAckRef.current = 0;
        }
        setState({ phase: "connected", sessionId: result.data.sessionId });
      } else {
        pendingLoginRef.current = login;
        setState({ phase: "confirmHostKey", algorithm: result.data.algorithm, fingerprint: result.data.fingerprint });
      }
    },
    [getTerminal, acknowledge],
  );

  const trustHostKeyAndConnect = useCallback(
    async (fingerprint: string) => {
      const login = pendingLoginRef.current;
      if (!login) return;
      pendingLoginRef.current = null;
      trustedRef.current.set(hostKeyId(login), fingerprint);
      await connect(login);
    },
    [connect],
  );

  const rejectHostKey = useCallback(() => {
    pendingLoginRef.current = null;
    setState({ phase: "idle" });
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
    await commands.sessionClose(id);
    setState({ phase: "closed", exitStatus: null });
  }, []);

  return { state, connect, trustHostKeyAndConnect, rejectHostKey, send, resize, disconnect };
}

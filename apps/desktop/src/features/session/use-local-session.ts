import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { commands } from "@/bindings";
import type { TerminalSize } from "@/features/terminal/terminal-view";
import { toBytes } from "@/features/terminal/to-bytes";

import type { HostSessionTerminal } from "./use-host-session";

export type LocalSessionState =
  | { phase: "starting" }
  | { phase: "running"; sessionId: number }
  | { phase: "exited"; exitStatus: number | null }
  | { phase: "error"; message: string };

/** Starts a shell on this machine once the terminal is mounted and stops it on unmount. */
export function useLocalSession(getTerminal: () => HostSessionTerminal | null) {
  const [state, setState] = useState<LocalSessionState>({ phase: "starting" });
  const sessionIdRef = useRef<number | null>(null);
  const unsentAckRef = useRef(0);
  const startedRef = useRef(false);
  const unmountedRef = useRef(false);
  const getTerminalRef = useRef(getTerminal);
  useLayoutEffect(() => {
    getTerminalRef.current = getTerminal;
  });

  const acknowledge = useCallback((bytes: number) => {
    const id = sessionIdRef.current;
    if (id === null) unsentAckRef.current += bytes;
    else void commands.sessionAcknowledgeOutput(id, bytes);
  }, []);

  const start = useCallback(async () => {
    const terminal = getTerminalRef.current();
    if (!terminal) return;
    const onOutput = new Channel<number[]>();
    onOutput.onmessage = (payload) => {
      const bytes = toBytes(payload);
      terminal.write(bytes, () => acknowledge(bytes.length));
    };
    const onClosed = new Channel<{ exitStatus: number | null }>();
    onClosed.onmessage = ({ exitStatus }) => {
      sessionIdRef.current = null;
      setState({ phase: "exited", exitStatus });
    };
    const { cols, rows } = terminal.size();
    const result = await commands.sessionOpenLocal(cols, rows, onOutput, onClosed);
    if (result.status === "error") {
      setState({ phase: "error", message: result.error.message });
      return;
    }
    if (unmountedRef.current) {
      void commands.sessionClose(result.data);
      return;
    }
    sessionIdRef.current = result.data;
    if (unsentAckRef.current > 0) {
      void commands.sessionAcknowledgeOutput(result.data, unsentAckRef.current);
      unsentAckRef.current = 0;
    }
    setState({ phase: "running", sessionId: result.data });
  }, [acknowledge]);

  useEffect(() => {
    unmountedRef.current = false;
    if (!startedRef.current) {
      startedRef.current = true;
      void start();
    }
    return () => {
      unmountedRef.current = true;
      const id = sessionIdRef.current;
      if (id !== null) {
        sessionIdRef.current = null;
        void commands.sessionClose(id);
      }
    };
  }, [start]);

  const restart = useCallback(() => {
    setState({ phase: "starting" });
    void start();
  }, [start]);

  const send = useCallback((data: string) => {
    const id = sessionIdRef.current;
    if (id !== null) void commands.sessionWrite(id, data);
  }, []);

  const resize = useCallback(({ cols, rows }: TerminalSize) => {
    const id = sessionIdRef.current;
    if (id !== null) void commands.sessionResize(id, cols, rows);
  }, []);

  return { state, restart, send, resize };
}

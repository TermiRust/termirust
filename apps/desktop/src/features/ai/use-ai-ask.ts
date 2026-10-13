import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { commands, type AiAsk, type AiEvent, type AiPreview } from "@/bindings";
import { needsPreview, useAiStore } from "@/stores/ai-store";

export type AiAskState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "previewing"; preview: AiPreview; ask: AiAsk }
  | { phase: "streaming"; text: string }
  | { phase: "done"; reply: string; command: string | null; danger: string | null; commands: string[] }
  | { phase: "failed"; message: string }
  | { phase: "cancelled" };

/** One AI question at a time: preview when required, stream the answer, allow cancel. */
export function useAiAsk() {
  const [state, setState] = useState<AiAskState>({ phase: "idle" });
  const requestIdRef = useRef<number | null>(null);
  // Bumped on reset/unmount so a late answer for an abandoned question is ignored.
  const generationRef = useRef(0);

  const send = useCallback(async (ask: AiAsk) => {
    const generation = generationRef.current;
    const current = () => generation === generationRef.current;
    setState({ phase: "streaming", text: "" });
    const channel = new Channel<AiEvent>();
    channel.onmessage = (event) => {
      if (!current()) return;
      switch (event.kind) {
        case "text":
          setState((s) => (s.phase === "streaming" ? { phase: "streaming", text: s.text + event.text } : s));
          break;
        case "done":
          requestIdRef.current = null;
          setState({ phase: "done", reply: event.reply, command: event.command, danger: event.danger, commands: event.commands });
          break;
        case "failed":
          requestIdRef.current = null;
          setState({ phase: "failed", message: event.message });
          break;
        case "cancelled":
          requestIdRef.current = null;
          setState({ phase: "cancelled" });
          break;
      }
    };
    const result = await commands.aiAsk(ask, channel);
    if (!current()) {
      if (result.status === "ok") void commands.aiCancel(result.data);
      return;
    }
    if (result.status === "error") setState({ phase: "failed", message: result.error.message });
    else requestIdRef.current = result.data;
  }, []);

  const ask = useCallback(
    async (request: AiAsk) => {
      if (!needsPreview(useAiStore.getState())) {
        await send(request);
        return;
      }
      const generation = generationRef.current;
      setState({ phase: "preparing" });
      const result = await commands.aiPreview(request);
      if (generation !== generationRef.current) return;
      if (result.status === "error") setState({ phase: "failed", message: result.error.message });
      else setState({ phase: "previewing", preview: result.data, ask: request });
    },
    [send],
  );

  const confirmPreview = useCallback(() => {
    if (state.phase !== "previewing") return;
    useAiStore.getState().markPreviewed();
    void send(state.ask);
  }, [state, send]);

  const cancel = useCallback(() => {
    const id = requestIdRef.current;
    if (id !== null) void commands.aiCancel(id);
  }, []);

  const reset = useCallback(() => {
    cancel();
    requestIdRef.current = null;
    generationRef.current++;
    setState({ phase: "idle" });
  }, [cancel]);

  useEffect(
    () => () => {
      generationRef.current++;
      const id = requestIdRef.current;
      if (id !== null) void commands.aiCancel(id);
    },
    [],
  );

  return { state, ask, confirmPreview, cancel, reset };
}

import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { commands, type AiAsk, type AiEvent, type AiPreview, type AiTarget, type SuggestedCommand } from "@/bindings";
import { needsPreview, useAiStore } from "@/stores/ai-store";

/** Terminal output attached to a question, labelled with its lines, e.g. "L35–L55". */
export interface ChatQuote {
  label: string;
  text: string;
}

export interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
  quotes: ChatQuote[];
  /** The terminal screen was attached to this question. */
  withScreen: boolean;
  status: "streaming" | "done" | "failed" | "cancelled";
  error?: string;
  commands: SuggestedCommand[];
}

export interface Outgoing {
  message: string;
  quotes: ChatQuote[];
  screen: ChatQuote | null;
}

let nextId = 1;

/** A conversation with the AI for one terminal: preview when required, streamed answers, cancel. */
export function useAiChat(target: AiTarget, hostId: string | null) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [preview, setPreview] = useState<{ preview: AiPreview; ask: AiAsk; outgoing: Outgoing } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const requestIdRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });

  const busy = preparing || entries.some((e) => e.status === "streaming");

  const buildAsk = (outgoing: Outgoing): AiAsk => ({
    target,
    hostId,
    // Earlier turns as the user saw them; quotes are only described, to keep requests small.
    history: entriesRef.current
      .filter((e) => e.status === "done" || e.role === "user")
      .map((e) => ({
        role: e.role,
        content: e.role === "user" && e.quotes.length > 0 ? `${e.text}\n(attached ${e.quotes.map((q) => q.label).join(", ")})`.trim() : e.text,
      })),
    message: outgoing.message,
    quotes: outgoing.quotes,
    screen: outgoing.screen?.text ?? null,
  });

  const updateEntry = (id: number, change: (e: ChatEntry) => ChatEntry) => setEntries((list) => list.map((e) => (e.id === id ? change(e) : e)));

  const send = useCallback(
    async (ask: AiAsk, outgoing: Outgoing) => {
      const generation = generationRef.current;
      const quotes = outgoing.screen ? [...outgoing.quotes, outgoing.screen] : outgoing.quotes;
      const user: ChatEntry = { id: nextId++, role: "user", text: outgoing.message, quotes, withScreen: Boolean(outgoing.screen), status: "done", commands: [] };
      const answer: ChatEntry = { id: nextId++, role: "assistant", text: "", quotes: [], withScreen: false, status: "streaming", commands: [] };
      setEntries((list) => [...list, user, answer]);
      const channel = new Channel<AiEvent>();
      channel.onmessage = (event) => {
        if (generation !== generationRef.current) return;
        switch (event.kind) {
          case "text":
            updateEntry(answer.id, (e) => ({ ...e, text: e.text + event.text }));
            break;
          case "done":
            requestIdRef.current = null;
            updateEntry(answer.id, (e) => ({ ...e, text: event.reply, status: "done", commands: event.commands }));
            break;
          case "failed":
            requestIdRef.current = null;
            updateEntry(answer.id, (e) => ({ ...e, status: "failed", error: event.message }));
            break;
          case "cancelled":
            requestIdRef.current = null;
            updateEntry(answer.id, (e) => ({ ...e, status: "cancelled" }));
            break;
        }
      };
      const result = await commands.aiAsk(ask, channel);
      if (generation !== generationRef.current) {
        if (result.status === "ok") void commands.aiCancel(result.data);
        return;
      }
      if (result.status === "error") updateEntry(answer.id, (e) => ({ ...e, status: "failed", error: result.error.message }));
      else requestIdRef.current = result.data;
    },
    [],
  );

  const ask = useCallback(
    async (outgoing: Outgoing) => {
      const request = buildAsk(outgoing);
      if (!needsPreview(useAiStore.getState())) {
        await send(request, outgoing);
        return;
      }
      const generation = generationRef.current;
      setPreparing(true);
      const result = await commands.aiPreview(request);
      setPreparing(false);
      if (generation !== generationRef.current) return;
      if (result.status === "error") {
        const failed: ChatEntry = { id: nextId++, role: "assistant", text: "", quotes: [], withScreen: false, status: "failed", error: result.error.message, commands: [] };
        setEntries((list) => [...list, failed]);
      } else setPreview({ preview: result.data, ask: request, outgoing });
    },
    // buildAsk reads refs only; target/hostId changes recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, target, hostId],
  );

  const confirmPreview = useCallback(() => {
    if (!preview) return;
    useAiStore.getState().markPreviewed();
    setPreview(null);
    void send(preview.ask, preview.outgoing);
  }, [preview, send]);

  const cancel = useCallback(() => {
    const id = requestIdRef.current;
    if (id !== null) void commands.aiCancel(id);
  }, []);

  const clear = useCallback(() => {
    cancel();
    requestIdRef.current = null;
    generationRef.current++;
    setPreview(null);
    setEntries([]);
  }, [cancel]);

  useEffect(
    () => () => {
      generationRef.current++;
      const id = requestIdRef.current;
      if (id !== null) void commands.aiCancel(id);
    },
    [],
  );

  return { entries, preview: preview?.preview ?? null, preparing, busy, ask, confirmPreview, dismissPreview: () => setPreview(null), cancel, clear };
}

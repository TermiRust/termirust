import { commands, type AiChatMessageDto, type SuggestedCommand } from "@/bindings";

import type { ChatEntry } from "./use-ai-chat";

/** A short title for History: the first question, or what was quoted when there was none. */
export function chatTitle(entries: Pick<ChatEntry, "role" | "text" | "quotes">[]): string {
  const first = entries.find((e) => e.role === "user");
  if (!first) return "Untitled chat";
  const text = first.text.trim().replace(/\s+/g, " ");
  if (text) return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  return first.quotes.length > 0 ? `Explain ${first.quotes.map((q) => q.label).join(", ")}` : "Untitled chat";
}

/** Finished messages in the shape the vault stores; failed or empty answers are left out. */
export function toSavedMessages(entries: ChatEntry[]): AiChatMessageDto[] {
  return entries
    .filter((e) => e.role === "user" || (e.status === "done" && e.text.trim().length > 0))
    .map((e) => ({ role: e.role, text: e.text, quotes: e.quotes.map((q) => ({ label: q.label, text: q.text })) }));
}

const SHELL_BLOCK = /```(?:sh|bash|shell|zsh|console)?\n([\s\S]*?)```/g;

/** Rebuilds Insert buttons (with danger notes) for an answer loaded from History. */
export async function suggestionsFor(reply: string): Promise<SuggestedCommand[]> {
  const blocks = [...reply.matchAll(SHELL_BLOCK)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
  return Promise.all(blocks.map(async (command) => ({ command, danger: await commands.commandDanger(command) })));
}

/** "3 min ago", "yesterday"… for History rows. */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

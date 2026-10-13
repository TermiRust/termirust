import { create } from "zustand";

import { commands, type CommandError, type SnippetInput, type SnippetView } from "@/bindings";

type Outcome<T> = { status: "ok"; data: T } | { status: "error"; error: CommandError };

interface SnippetsState {
  snippets: SnippetView[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: SnippetInput) => Promise<Outcome<SnippetView>>;
  update: (id: string, input: SnippetInput) => Promise<Outcome<SnippetView>>;
  remove: (id: string) => Promise<Outcome<null>>;
}

const byName = (a: SnippetView, b: SnippetView) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export const useSnippetsStore = create<SnippetsState>()((set) => ({
  snippets: [],
  loaded: false,
  error: null,

  load: async () => {
    const result = await commands.snippetsList();
    if (result.status === "ok") set({ snippets: result.data, loaded: true, error: null });
    else set({ loaded: true, error: result.error.message });
  },

  create: async (input) => {
    const result = await commands.snippetsCreate(input);
    if (result.status === "ok") set((s) => ({ snippets: [...s.snippets, result.data].sort(byName) }));
    return result;
  },

  update: async (id, input) => {
    const result = await commands.snippetsUpdate(id, input);
    if (result.status === "ok") set((s) => ({ snippets: s.snippets.map((x) => (x.id === id ? result.data : x)).sort(byName) }));
    return result;
  },

  remove: async (id) => {
    const result = await commands.snippetsDelete(id);
    if (result.status === "ok") set((s) => ({ snippets: s.snippets.filter((x) => x.id !== id) }));
    return result;
  },
}));

/** Every word of the query must appear in the name, command, description or tags. */
export function matchesSnippet(snippet: SnippetView, query: string): boolean {
  const haystack = [snippet.name, snippet.command, snippet.description, ...snippet.tags].join("\n").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

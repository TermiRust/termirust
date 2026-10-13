import { Pencil, Plus, SquareCode, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { SnippetView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/features/sftp/file-dialogs";
import { matchesSnippet, useSnippetsStore } from "@/stores/snippets-store";

import { SnippetDialog } from "./snippet-dialog";
import { parseVariables } from "./variables";

interface SnippetsViewProps {
  /** Runs or inserts a snippet in the active terminal tab; absent when no tab can take it. */
  onUse?: (snippet: SnippetView) => void;
}

export function SnippetsView({ onUse }: SnippetsViewProps) {
  const { snippets, loaded, error, load, remove } = useSnippetsStore();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SnippetView | "new" | null>(null);
  const [deleting, setDeleting] = useState<SnippetView | null>(null);
  const shown = useMemo(() => snippets.filter((s) => matchesSnippet(s, query)), [snippets, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="Snippets" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <SquareCode size={16} className="text-fg-muted" />
        <h1 className="text-[15px] font-semibold">Snippets</h1>
        <span className="text-xs text-fg-muted">Saved commands, encrypted in your vault</span>
        <Input
          type="search"
          aria-label="Search snippets"
          placeholder="Search name, command or tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto h-7 w-64"
        />
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          <Plus size={14} /> New snippet
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {loaded && snippets.length === 0 && !error && (
          <div className="mx-auto mt-16 max-w-sm text-center text-fg-muted">
            <p className="text-fg">No snippets yet</p>
            <p className="mt-1 text-[13px]">Save the long commands you keep retyping. Use {"{{name}}"} for parts that change.</p>
          </div>
        )}
        {snippets.length > 0 && shown.length === 0 && <p className="text-[13px] text-fg-muted">No snippet matches “{query}”.</p>}
        <ul aria-label="Snippet list" className="grid gap-2">
          {shown.map((snippet) => {
            const variables = parseVariables(snippet.command);
            return (
              <li key={snippet.id} aria-label={snippet.name} className="rounded-lg border border-border bg-bg-elev px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{snippet.name}</span>
                  {snippet.tags.map((tag) => (
                    <span key={tag} className="rounded border border-border px-1 text-[10px] text-fg-muted">
                      {tag}
                    </span>
                  ))}
                  <div className="ml-auto flex shrink-0 gap-1">
                    {onUse && (
                      <Button size="sm" variant="outline" onClick={() => onUse(snippet)} aria-label={`Use ${snippet.name}`}>
                        Use
                      </Button>
                    )}
                    <Button size="icon" aria-label={`Edit ${snippet.name}`} onClick={() => setEditing(snippet)}>
                      <Pencil size={13} />
                    </Button>
                    <Button size="icon" aria-label={`Delete ${snippet.name}`} onClick={() => setDeleting(snippet)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
                <pre className="mt-1 max-h-20 overflow-hidden font-mono text-xs whitespace-pre-wrap text-fg-2">{snippet.command}</pre>
                {(snippet.description || variables.length > 0) && (
                  <p className="mt-1 text-xs text-fg-muted">
                    {snippet.description}
                    {snippet.description && variables.length > 0 && " · "}
                    {variables.length > 0 && `asks for ${variables.map((v) => v.name).join(", ")}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {editing && <SnippetDialog snippet={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          danger
          title={`Delete ${deleting.name}?`}
          description="This removes the snippet from your vault."
          items={[deleting.command.split("\n")[0] ?? ""]}
          action="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => void remove(deleting.id)}
        />
      )}
    </section>
  );
}

import type { SearchAddon } from "@xterm/addon-search";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TerminalSearchBarProps {
  search: Pick<SearchAddon, "findNext" | "findPrevious" | "clearDecorations" | "onDidChangeResults">;
  onClose: () => void;
}

const decorations = {
  matchBackground: "#fb923c55",
  activeMatchBackground: "#fb923c",
  matchOverviewRuler: "#fb923c",
  activeMatchColorOverviewRuler: "#fb923c",
};

export function TerminalSearchBar({ search, onClose }: TerminalSearchBarProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<{ index: number; count: number } | null>(null);

  useEffect(() => {
    const sub = search.onDidChangeResults(({ resultIndex, resultCount }) => setResults({ index: resultIndex, count: resultCount }));
    return () => {
      sub.dispose();
      search.clearDecorations();
    };
  }, [search]);

  const options = { caseSensitive, decorations, incremental: false };
  const next = () => query && search.findNext(query, options);
  const previous = () => query && search.findPrevious(query, options);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) previous();
      else next();
    }
  };

  return (
    <div role="search" aria-label="Find in terminal" className="absolute top-2 right-4 flex items-center gap-1 rounded-md border border-border bg-bg-elev p-1 shadow-panel">
      <input
        autoFocus
        aria-label="Find"
        value={query}
        placeholder="Find"
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) search.findNext(e.target.value, { ...options, incremental: true });
          else search.clearDecorations();
        }}
        onKeyDown={onKeyDown}
        className="h-7 w-48 rounded bg-transparent px-2 text-[13px] text-fg outline-none placeholder:text-fg-faint"
      />
      <span className="min-w-12 text-center text-xs text-fg-muted" aria-live="polite">
        {query && results ? (results.count === 0 ? "No results" : `${results.index + 1} of ${results.count}`) : ""}
      </span>
      <button
        type="button"
        aria-label="Match case"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((c) => !c)}
        className={cn("h-7 rounded px-1.5 font-mono text-xs", caseSensitive ? "bg-active text-fg" : "text-fg-muted hover:bg-hover")}
      >
        Aa
      </button>
      <Button size="icon" aria-label="Previous match" onClick={previous}>
        <ChevronUp size={14} />
      </Button>
      <Button size="icon" aria-label="Next match" onClick={next}>
        <ChevronDown size={14} />
      </Button>
      <Button size="icon" aria-label="Close find" onClick={onClose}>
        <X size={14} />
      </Button>
    </div>
  );
}

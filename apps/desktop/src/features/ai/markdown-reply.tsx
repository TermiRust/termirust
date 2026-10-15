import { openUrl } from "@tauri-apps/plugin-opener";
import { CornerDownLeft, TriangleAlert } from "lucide-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { SuggestedCommand } from "@/bindings";
import { Button } from "@/components/ui/button";

interface MarkdownReplyProps {
  text: string;
  /** Shell blocks of a finished reply; their commands get an Insert button. */
  commands: SuggestedCommand[];
  onInsert: (command: string) => void;
}

const SHELL = /^language-(sh|bash|shell|zsh|console)$/;

// Renderers must keep the same identity across renders, or every re-render would remount
// the code blocks (flicker, and an Insert click landing on a replaced button). Per-reply
// data reaches them through context instead.
const ReplyContext = createContext<{ commands: SuggestedCommand[]; onInsert: (command: string) => void }>({ commands: [], onInsert: () => {} });

function CodeRenderer({ className, children }: { className?: string; children?: ReactNode }) {
  const { commands, onInsert } = useContext(ReplyContext);
  const code = String(children ?? "").replace(/\n$/, "");
  const block = Boolean(className) || code.includes("\n");
  if (!block) return <code className="rounded bg-bg-sunk px-1 py-0.5 font-mono text-[12px]">{children}</code>;
  const isShell = !className || SHELL.test(className);
  const suggestion = isShell ? commands.find((c) => c.command === code.trim()) : undefined;
  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-bg-sunk">
      {/* Long commands wrap instead of scrolling sideways; Insert still sends the exact text. */}
      <pre data-testid="code-block" className="p-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        <code>{code}</code>
      </pre>
      {suggestion && (
        <div className="flex items-center gap-2 border-t border-border px-2 py-1">
          {suggestion.danger && (
            <span role="alert" className="flex items-center gap-1 text-[11px] text-danger">
              <TriangleAlert size={12} /> This {suggestion.danger}.
            </span>
          )}
          <Button
            size="sm"
            variant={suggestion.danger ? "danger" : "outline"}
            className="ml-auto h-6"
            aria-label={`Insert into terminal: ${suggestion.command}`}
            onClick={() => onInsert(suggestion.command)}
          >
            <CornerDownLeft size={11} /> Insert
          </Button>
        </div>
      )}
    </div>
  );
}

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-accent underline"
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:/.test(href)) void openUrl(href).catch(() => {});
      }}
    >
      {children}
    </a>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => <CodeRenderer className={className}>{children}</CodeRenderer>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  // `start` continues the numbering when a code block splits one list in two.
  ol: ({ children, start }) => (
    <ol start={start} className="my-1.5 list-decimal pl-5">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  p: ({ children }) => <p className="my-1.5">{children}</p>,
  h1: ({ children }) => <h3 className="mt-3 mb-1 text-[14px] font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1 text-[14px] font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-2 mb-1 text-[13px] font-semibold">{children}</h4>,
  blockquote: ({ children }) => <blockquote className="my-1.5 border-l-2 border-border-strong pl-2 text-fg-2">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
};

const REMARK_PLUGINS = [remarkGfm];

/** Renders the AI's Markdown. Raw HTML is never rendered; links open in the browser. */
export function MarkdownReply({ text, commands, onInsert }: MarkdownReplyProps) {
  const value = useMemo(() => ({ commands, onInsert }), [commands, onInsert]);
  return (
    <ReplyContext.Provider value={value}>
      <div className="text-[13px] leading-relaxed break-words">
        <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
          {text}
        </Markdown>
      </div>
    </ReplyContext.Provider>
  );
}

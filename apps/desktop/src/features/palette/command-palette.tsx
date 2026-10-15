import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, Server, SquareCode } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import type { HostView, SnippetView } from "@/bindings";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { rankByFuzzy } from "./fuzzy";

export interface PaletteCommand {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  run: () => void;
}

interface Item {
  key: string;
  section: "Recent" | "Hosts" | "Snippets" | "Commands";
  label: string;
  detail?: string;
  icon: ReactNode;
  shortcut?: string;
  indices: number[];
  run: () => void;
  /** Shift+Enter on a host: open SFTP instead of a terminal. */
  runAlt?: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hosts: HostView[];
  recentHostIds: string[];
  commands: PaletteCommand[];
  onOpenHost: (host: HostView) => void;
  onOpenSftp?: (host: HostView) => void;
  snippets?: SnippetView[];
  onRunSnippet?: (snippet: SnippetView) => void;
}

const address = (h: HostView) => `${h.username ? `${h.username}@` : ""}${h.hostname}${h.port === 22 ? "" : `:${h.port}`}`;

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const marked = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) => (marked.has(i) ? <mark key={i} className="bg-transparent font-semibold text-accent">{ch}</mark> : ch))}
    </>
  );
}

export function CommandPalette({ open, onOpenChange, ...props }: CommandPaletteProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="motion-overlay fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Content
          aria-label="Command palette"
          className="motion-rise fixed inset-x-0 top-[14vh] z-50 mx-auto w-[min(600px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border bg-bg shadow-dialog"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search hosts and commands</DialogPrimitive.Description>
          <PaletteBody {...props} close={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({ hosts, recentHostIds, commands, onOpenHost, onOpenSftp, snippets = [], onRunSnippet, close }: Omit<CommandPaletteProps, "open" | "onOpenChange"> & { close: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo<Item[]>(() => {
    const openHost = (h: HostView) => () => {
      close();
      onOpenHost(h);
    };
    const hostItem = (section: Item["section"], h: HostView, indices: number[] = []): Item => ({
      key: `${section}:${h.id}`,
      section,
      label: h.label,
      detail: address(h),
      icon: <Server size={14} />,
      indices,
      run: openHost(h),
      runAlt: onOpenSftp
        ? () => {
            close();
            onOpenSftp(h);
          }
        : undefined,
    });
    const commandItems = (list: { item: PaletteCommand; indices: number[] }[]): Item[] =>
      list.map(({ item, indices }) => ({
        key: `cmd:${item.id}`,
        section: "Commands",
        label: item.label,
        icon: item.icon,
        shortcut: item.shortcut,
        indices,
        run: () => {
          close();
          item.run();
        },
      }));

    if (!query.trim()) {
      const recent = recentHostIds.map((id) => hosts.find((h) => h.id === id)).filter((h): h is HostView => Boolean(h));
      return [...recent.map((h) => hostItem("Recent", h)), ...commandItems(commands.map((c) => ({ item: c, indices: [] })))];
    }
    const matchedHosts = rankByFuzzy(hosts, query, (h) => h.label).map(({ item, match }) => hostItem("Hosts", item, match.indices));
    const byAddress = rankByFuzzy(hosts, query, (h) => `${h.hostname} ${h.tags.join(" ")}`)
      .filter(({ item }) => !matchedHosts.some((m) => m.key === `Hosts:${item.id}`))
      .map(({ item }) => hostItem("Hosts", item));
    const matchedCommands = rankByFuzzy(commands, query, (c) => c.label).map(({ item, match }) => ({ item, indices: match.indices }));
    const matchedSnippets: Item[] = onRunSnippet
      ? rankByFuzzy(snippets, query, (s) => s.name).map(({ item, match }) => ({
          key: `snippet:${item.id}`,
          section: "Snippets",
          label: item.name,
          detail: item.command.split("\n")[0],
          icon: <SquareCode size={14} />,
          indices: match.indices,
          run: () => {
            close();
            onRunSnippet(item);
          },
        }))
      : [];
    return [...matchedHosts, ...byAddress, ...matchedSnippets, ...commandItems(matchedCommands)].slice(0, 30);
  }, [query, hosts, recentHostIds, commands, onOpenHost, onOpenSftp, snippets, onRunSnippet, close]);

  const current = Math.min(active, Math.max(items.length - 1, 0));

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length === 0) return;
      setActive((current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[current];
      if (event.shiftKey && item?.runAlt) item.runAlt();
      else item?.run();
    }
  };

  let lastSection: string | null = null;
  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search size={15} className="text-fg-muted" />
        <input
          autoFocus
          aria-label="Search hosts and commands"
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={items[current] ? `palette-${current}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Search hosts and commands…"
          className="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-faint"
        />
      </div>
      <ul id="palette-results" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-1.5">
        {items.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-fg-muted">No matches for “{query}”</li>}
        {items.map((item, index) => {
          const header = item.section !== lastSection ? item.section : null;
          lastSection = item.section;
          return (
            <li key={item.key} role="presentation">
              {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-fg-muted uppercase">{header}</div>}
              <div
                id={`palette-${index}`}
                role="option"
                aria-selected={index === current}
                onMouseMove={() => setActive(index)}
                onClick={item.run}
                className={cn("flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px]", index === current && "bg-active")}
              >
                <span className="text-fg-muted">{item.icon}</span>
                <span className="truncate">
                  <Highlighted text={item.label} indices={item.indices} />
                </span>
                {item.detail && <span className="truncate font-mono text-xs text-fg-muted">{item.detail}</span>}
                <span className="ml-auto flex items-center gap-2">
                  {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                  {(item.section === "Recent" || item.section === "Hosts") && index === current && (
                    <span className="text-xs text-fg-muted">Connect ↵{item.runAlt ? " · SFTP ⇧↵" : ""}</span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { Columns2, Copy, Rows2, Search, SquareTerminal } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { HostView } from "@/bindings";
import { EnvironmentBadge } from "@/components/ui/environment-badge";
import { OsIcon } from "@/components/ui/os-icon";
import { hostMatches } from "@/features/hosts/host-tree";
import { cn } from "@/lib/utils";
import type { PaneTarget } from "@/stores/tabs-store";

interface SplitPickerProps {
  hosts: HostView[];
  /** What the focused pane runs, offered first as "same as this pane". */
  current: PaneTarget | null;
  /** Anchor: the picker opens below this point, right-aligned. */
  right: number;
  top: number;
  onPick: (target: PaneTarget, direction: "row" | "column") => void;
  onClose: () => void;
}

interface Choice {
  key: string;
  label: string;
  detail: string;
  icon: ReactNode;
  badge?: ReactNode;
  target: PaneTarget;
}

/** Split → choose what the new pane opens, so several servers can sit side by side. */
export function SplitPicker({ hosts, current, right, top, onPick, onClose }: SplitPickerProps) {
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"row" | "column">("row");
  const [cursor, setCursor] = useState(0);

  const choices = useMemo<Choice[]>(() => {
    const q = query.trim().toLowerCase();
    const list: Choice[] = [];
    if (current && !q) {
      list.push({
        key: "same",
        label: current.kind === "host" ? `Same host · ${current.host.label}` : "Same · local terminal",
        detail: "Another session to what this pane runs",
        icon: <Copy size={14} className="text-fg-muted" />,
        target: current,
      });
    }
    if (!q || "local terminal".includes(q)) {
      list.push({ key: "local", label: "Local terminal", detail: "A shell on this computer", icon: <SquareTerminal size={14} className="text-fg-muted" />, target: { kind: "local" } });
    }
    hosts
      .filter((h) => hostMatches(h, query))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))
      .forEach((h) =>
        list.push({
          key: h.id,
          label: h.label,
          detail: `${h.username ? `${h.username}@` : ""}${h.hostname}`,
          icon: <OsIcon os={h.os} size={14} />,
          badge: <EnvironmentBadge environment={h.environment} />,
          target: { kind: "host", host: h },
        }),
      );
    return list;
  }, [hosts, current, query]);

  const active = Math.min(cursor, Math.max(choices.length - 1, 0));
  const pick = (choice: Choice | undefined) => {
    if (!choice) return;
    onClose();
    onPick(choice.target, direction);
  };

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-30" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-label="Split pane"
        className="motion-pop fixed z-40 flex w-[min(340px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-dialog"
        style={{ right, top, transformOrigin: "top right" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(0, Math.min(choices.length - 1, c + (e.key === "ArrowDown" ? 1 : -1))));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(choices[active]);
          }
        }}
      >
        <div className="flex items-center gap-1 border-b border-border p-1.5">
          {(
            [
              ["row", "Side by side", <Columns2 key="r" size={13} />],
              ["column", "Stacked", <Rows2 key="c" size={13} />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={direction === value}
              onClick={() => setDirection(value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-[12px]",
                direction === value ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-hover",
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-b border-border px-2.5">
          <Search size={13} className="text-fg-muted" aria-hidden />
          <input
            autoFocus
            aria-label="Open in the new pane"
            placeholder="Open in the new pane…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            className="h-9 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-faint"
          />
        </div>
        <ul role="listbox" aria-label="Open in the new pane" className="max-h-[50vh] overflow-y-auto p-1">
          {choices.length === 0 && <li className="px-3 py-4 text-center text-[12px] text-fg-muted">No host matches “{query}”</li>}
          {choices.map((choice, index) => (
            <li
              key={choice.key}
              role="option"
              aria-selected={index === active}
              aria-label={choice.label}
              onMouseMove={() => setCursor(index)}
              onClick={() => pick(choice)}
              className={cn("flex cursor-default items-center gap-2.5 rounded px-2 py-1.5", index === active && "bg-hover")}
            >
              {choice.icon}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px]">
                  <span className="truncate">{choice.label}</span>
                  {choice.badge}
                </span>
                <span className="block truncate font-mono text-[11px] text-fg-muted">{choice.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

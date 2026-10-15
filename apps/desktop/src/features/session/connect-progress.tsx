import { CheckCircle2, CircleAlert, Copy, Hourglass, Info, Pencil, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CONNECT_STEPS, logTime as time, plainLog, type LogLevel } from "./connect-log";
import type { ConnectTrace } from "./use-host-session";

type StepState = "done" | "current" | "waiting" | "failed" | "pending";

function stateOf(index: number, trace: ConnectTrace): StepState {
  if (index < trace.step) return "done";
  if (index > trace.step) return "pending";
  if (trace.failed) return "failed";
  if (trace.waiting) return "waiting";
  return index === CONNECT_STEPS.length - 1 ? "done" : "current";
}

/** Open ── Connect ── Verify ── Log in ── Terminal: grey until reached, then primary with a dot. */
export function ConnectSteps({ trace }: { trace: ConnectTrace }) {
  return (
    <ol aria-label="Connection steps" className="flex w-full">
      {CONNECT_STEPS.map((label, index) => {
        const state = stateOf(index, trace);
        const active = state === "current" || state === "waiting" || state === "failed";
        return (
          <li key={label} aria-current={active ? "step" : undefined} data-state={state} className="relative flex flex-1 flex-col items-center">
            {index < CONNECT_STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn("absolute top-[5px] left-1/2 h-0.5 w-full transition-colors duration-300", index < trace.step ? "bg-accent" : "bg-border-strong")}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 h-3 w-3 rounded-full transition-colors duration-300",
                state === "pending" && "bg-border-strong",
                (state === "done" || state === "current" || state === "waiting") && "bg-accent",
                state === "failed" && "bg-danger",
                (state === "current" || state === "waiting") && "shadow-[0_0_0_4px_var(--accent-ring)]",
                state === "waiting" && "animate-pulse",
              )}
            />
            <span
              className={cn(
                "mt-2 text-[11px] whitespace-nowrap",
                state === "failed" ? "font-medium text-danger" : active ? "font-medium text-fg" : state === "done" ? "text-fg-2" : "text-fg-faint",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const ICON: Record<LogLevel, typeof Info> = { info: Info, ok: CheckCircle2, wait: Hourglass, error: CircleAlert };


interface ConnectPanelProps {
  title: string;
  trace: ConnectTrace;
  /** Shown while a proxy command may wait for a browser sign-in. */
  proxyHint?: boolean;
  onRetry?: () => void;
  onEditHost?: () => void;
}

/** The step display and a readable log of the attempt, over the terminal until it connects. */
export function ConnectPanel({ title, trace, proxyHint, onRetry, onEditHost }: ConnectPanelProps) {
  const done = trace.failed;
  return (
    <section aria-label="Connection progress" className="absolute inset-0 z-10 flex items-center justify-center bg-bg/95 p-6">
      <div className="flex w-[min(560px,100%)] flex-col gap-5">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <ConnectSteps trace={trace} />
        {proxyHint && !done && trace.step < 2 && (
          <p role="status" className="rounded-md bg-accent-soft px-3 py-1.5 text-[12px] text-fg-2">
            Connecting through the proxy command… If a browser window opens (e.g. Cloudflare Access), finish signing in there.
          </p>
        )}
        <ol aria-label="Connection log" className="max-h-56 overflow-y-auto rounded-md border border-border bg-bg-sunk px-3 py-2 font-mono text-[11.5px] leading-5">
          {trace.lines.map((line, i) => {
            const Icon = ICON[line.level];
            return (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-fg-faint tabular-nums">{time(line.at)}</span>
                <Icon
                  size={12}
                  aria-hidden
                  className={cn("mt-1 shrink-0", line.level === "ok" && "text-ok", line.level === "wait" && "text-warn", line.level === "error" && "text-danger", line.level === "info" && "text-fg-muted")}
                />
                <span className="min-w-0 break-words">
                  <span className={cn(line.level === "error" && "text-danger")}>{line.text}</span>
                  {line.hint && <span className="block font-sans text-[12px] text-fg-muted">{line.hint}</span>}
                </span>
              </li>
            );
          })}
        </ol>
        {done && (
          <div className="flex gap-2">
            {onRetry && (
              <Button size="sm" variant="primary" onClick={onRetry}>
                <RotateCw size={13} /> Try again
              </Button>
            )}
            {onEditHost && (
              <Button size="sm" variant="outline" onClick={onEditHost}>
                <Pencil size={13} /> Edit host
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(plainLog(trace.lines))}>
              <Copy size={13} /> Copy log
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

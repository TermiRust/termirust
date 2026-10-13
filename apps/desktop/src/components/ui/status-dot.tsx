import { cn } from "@/lib/utils";

export type DotState = "on" | "warn" | "err" | "idle";

const labels: Record<DotState, string> = { on: "Connected", warn: "Connecting", err: "Disconnected", idle: "Not open" };

/** The mockup's status dot: filled green/amber/red, or a hollow grey ring when nothing is open. */
export function StatusDot({ state, className }: { state: DotState; className?: string }) {
  return (
    <span
      role="img"
      aria-label={labels[state]}
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full border-[1.5px]",
        state === "on" && "border-ok bg-ok shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ok)_18%,transparent)]",
        state === "warn" && "animate-pulse border-warn bg-warn",
        state === "err" && "border-danger bg-danger",
        state === "idle" && "border-fg-faint",
        className,
      )}
    />
  );
}

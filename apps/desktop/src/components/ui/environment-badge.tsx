import type { EnvironmentView } from "@/bindings";
import { cn } from "@/lib/utils";

const LABELS: Record<EnvironmentView, string> = { production: "PROD", staging: "STG", development: "DEV" };
const NAMES: Record<EnvironmentView, string> = { production: "Production", staging: "Staging", development: "Development" };

/** Small PROD / STG / DEV chip; production is loud on purpose. */
export function EnvironmentBadge({ environment, className }: { environment: EnvironmentView | null | undefined; className?: string }) {
  if (!environment) return null;
  return (
    <span
      title={NAMES[environment]}
      className={cn(
        "shrink-0 rounded px-1 text-[10px] leading-4 font-semibold tracking-wide",
        environment === "production" && "bg-danger text-white",
        environment === "staging" && "bg-warn/20 text-warn",
        environment === "development" && "border border-border-strong text-fg-muted",
        className,
      )}
    >
      {LABELS[environment]}
    </span>
  );
}

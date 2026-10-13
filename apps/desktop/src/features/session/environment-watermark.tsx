import type { EnvironmentView } from "@/bindings";

/**
 * A large faint label over production (and staging) terminals so nobody forgets where they
 * are typing. Purely visual: it never takes clicks or selection.
 */
export function EnvironmentWatermark({ environment }: { environment: EnvironmentView | null | undefined }) {
  if (environment !== "production" && environment !== "staging") return null;
  const production = environment === "production";
  return (
    <div aria-hidden data-testid="environment-watermark" className="pointer-events-none absolute inset-0 z-[5] grid place-items-center overflow-hidden select-none">
      <span
        className="-rotate-12 text-[min(18vw,160px)] font-black tracking-[0.12em] whitespace-nowrap"
        style={{ color: production ? "rgba(239, 68, 68, 0.09)" : "rgba(245, 158, 11, 0.06)" }}
      >
        {production ? "PROD" : "STAGING"}
      </span>
    </div>
  );
}

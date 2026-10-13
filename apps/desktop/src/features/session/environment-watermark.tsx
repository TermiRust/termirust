import type { EnvironmentView } from "@/bindings";

import { watermarkTile } from "./watermark-tile";

const STYLES = {
  production: { word: "PROD", badge: "PRODUCTION", tile: "rgba(239, 68, 68, 0.11)", badgeClass: "bg-danger text-white" },
  staging: { word: "STAGING", badge: "STAGING", tile: "rgba(245, 158, 11, 0.08)", badgeClass: "bg-warn text-black" },
} as const;

/**
 * Marks production (and staging) terminals so nobody forgets where they are typing: a
 * repeating watermark over the whole surface plus a badge in the corner that output never
 * covers. Purely visual — it never takes clicks or selection.
 */
export function EnvironmentWatermark({ environment }: { environment: EnvironmentView | null | undefined }) {
  if (environment !== "production" && environment !== "staging") return null;
  const style = STYLES[environment];
  return (
    <div aria-hidden data-testid="environment-watermark" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden select-none">
      <div data-testid="watermark-tiles" className="absolute inset-0" style={{ backgroundImage: watermarkTile(style.word, style.tile), backgroundRepeat: "repeat" }} />
      <span className={`absolute top-2 right-5 rounded px-2 py-0.5 text-[11px] font-bold tracking-[0.14em] shadow ${style.badgeClass}`}>{style.badge}</span>
    </div>
  );
}

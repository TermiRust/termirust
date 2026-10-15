/**
 * A release can require everyone below a version to update (e.g. after a security fix) by
 * putting `<!-- minimum-version: 0.2.0 -->` in its release notes, which the updater manifest
 * carries as `notes`.
 */
const MARKER = /<!--\s*minimum-version:\s*v?([0-9]+(?:\.[0-9]+){0,2})\s*-->/i;

export function minimumVersionOf(notes: string | null | undefined): string | null {
  return notes?.match(MARKER)?.[1] ?? null;
}

/** Compares dotted numeric versions ("0.10.0" > "0.9.3"); a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    (v.replace(/^v/, "").split(/[-+]/)[0] ?? "")
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** True when the running version is older than the release's required minimum. */
export function isUpdateRequired(current: string, notes: string | null | undefined): boolean {
  const minimum = minimumVersionOf(notes);
  return minimum !== null && compareVersions(current, minimum) < 0;
}

/** Release notes without the hidden marker, for display. */
export function visibleNotes(notes: string | null | undefined): string {
  return (notes ?? "").replace(MARKER, "").trim();
}

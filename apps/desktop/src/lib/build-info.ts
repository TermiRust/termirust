/** "v0.0.1 · 43aa2ea": the app version plus the commit it was built from. */
export function versionLabel(version: string | null | undefined, buildId: string = __BUILD_ID__): string | null {
  if (!version) return null;
  return buildId ? `v${version} · ${buildId}` : `v${version}`;
}

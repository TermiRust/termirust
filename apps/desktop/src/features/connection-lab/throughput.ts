export interface ThroughputResult {
  transport: "raw" | "json";
  totalBytes: number;
  messages: number;
  elapsedMs: number;
}

export function megabytesPerSecond(totalBytes: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return totalBytes / (1024 * 1024) / (elapsedMs / 1000);
}

export function describeThroughput(result: ThroughputResult): string {
  const mb = result.totalBytes / (1024 * 1024);
  const rate = megabytesPerSecond(result.totalBytes, result.elapsedMs);
  return `${result.transport.toUpperCase()}: ${mb.toFixed(0)} MB in ${(result.elapsedMs / 1000).toFixed(2)} s · ${rate.toFixed(1)} MB/s · ${result.messages} messages`;
}

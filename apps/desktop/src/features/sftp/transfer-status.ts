import type { TransferEvent } from "@/bindings";

import { formatBytes } from "./format";

export function progressOf(event: TransferEvent): number {
  if (event.state === "completed") return 1;
  if (event.state === "running") return event.total > 0 ? Math.min(1, event.done / event.total) : 0;
  return 0;
}

export function statusText(event: TransferEvent): string {
  switch (event.state) {
    case "queued":
      return "Waiting…";
    case "running": {
      const files = event.filesTotal > 1 ? ` · ${event.filesDone}/${event.filesTotal} files` : "";
      return `${formatBytes(event.done)} / ${formatBytes(event.total)}${files}`;
    }
    case "completed":
      return `Done · ${formatBytes(event.bytes)}`;
    case "failed":
      return event.message;
    case "cancelled":
      return "Cancelled";
  }
}

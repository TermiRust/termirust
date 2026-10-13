import { ArrowDown, ArrowUp, RotateCcw, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isFinished, useTransfersStore, type TransferItem } from "@/stores/transfers-store";

import { progressOf, statusText } from "./transfer-status";

/** The transfers of one SFTP tab: progress, cancel, retry, and clearing finished ones. */
export function TransferQueuePanel({ sftpId }: { sftpId: number }) {
  const items = useTransfersStore(useShallow((s) => s.items.filter((t) => t.request.sftpId === sftpId)));
  const { cancel, retry, dismiss, clearFinished } = useTransfersStore.getState();
  if (items.length === 0) return null;
  const active = items.filter((t) => !isFinished(t.event)).length;

  return (
    <section aria-label="Transfers" className="motion-rise flex max-h-48 shrink-0 flex-col border-t border-border bg-bg-sunk">
      <header className="flex h-7 shrink-0 items-center gap-2 px-3 text-[11px] text-fg-muted">
        <span className="font-semibold tracking-wider uppercase">Transfers</span>
        <span>{active > 0 ? `${active} active` : "all done"}</span>
        <Button size="sm" className="ml-auto h-5 px-1.5 text-[11px]" onClick={() => clearFinished(sftpId)} disabled={active === items.length}>
          Clear finished
        </Button>
      </header>
      <ul className="min-h-0 overflow-y-auto px-2 pb-1">
        {items.map((item) => (
          <TransferRow key={item.key} item={item} onCancel={() => cancel(item.key)} onRetry={() => void retry(item.key)} onDismiss={() => dismiss(item.key)} />
        ))}
      </ul>
    </section>
  );
}

function TransferRow({ item, onCancel, onRetry, onDismiss }: { item: TransferItem; onCancel: () => void; onRetry: () => void; onDismiss: () => void }) {
  const { event } = item;
  const upload = item.request.direction === "upload";
  const finished = isFinished(event);
  const fraction = progressOf(event);
  return (
    <li aria-label={`${upload ? "Upload" : "Download"} ${item.name}`} className="flex h-7 items-center gap-2 rounded px-1 text-xs hover:bg-hover">
      {upload ? <ArrowUp size={12} className="shrink-0 text-fg-muted" /> : <ArrowDown size={12} className="shrink-0 text-fg-muted" />}
      <span className="w-40 shrink-0 truncate" title={upload ? item.request.remotePath : item.request.localPath}>
        {item.name}
      </span>
      <div
        role="progressbar"
        aria-label={`${item.name} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border"
      >
        <div
          className={cn("h-full rounded-full", event.state === "failed" ? "bg-danger" : event.state === "completed" ? "bg-ok" : "bg-accent")}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span className={cn("w-72 shrink-0 truncate text-right text-[11px] tabular-nums", event.state === "failed" ? "text-danger" : "text-fg-muted")} title={statusText(event, item.rate)}>
        {statusText(event, item.rate)}
      </span>
      {!finished && (
        <button type="button" aria-label={`Cancel ${item.name}`} onClick={onCancel} className="rounded p-0.5 text-fg-muted hover:bg-active hover:text-fg">
          <X size={12} />
        </button>
      )}
      {(event.state === "failed" || event.state === "cancelled") && (
        <button type="button" aria-label={`Retry ${item.name}`} onClick={onRetry} className="rounded p-0.5 text-fg-muted hover:bg-active hover:text-fg">
          <RotateCcw size={12} />
        </button>
      )}
      {finished && (
        <button type="button" aria-label={`Remove ${item.name} from the list`} onClick={onDismiss} className="rounded p-0.5 text-fg-muted hover:bg-active hover:text-fg">
          <X size={12} />
        </button>
      )}
    </li>
  );
}

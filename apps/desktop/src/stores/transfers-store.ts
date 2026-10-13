import { Channel } from "@tauri-apps/api/core";
import { create } from "zustand";

import { commands, type TransferEvent, type TransferRequest } from "@/bindings";

export interface TransferItem {
  key: string;
  /** Backend id once queued; null if starting failed. */
  transferId: number | null;
  request: TransferRequest;
  /** File or folder name shown in the queue. */
  name: string;
  event: TransferEvent;
}

export const isFinished = (event: TransferEvent) =>
  event.state === "completed" || event.state === "failed" || event.state === "cancelled";

interface TransfersState {
  items: TransferItem[];
  start: (request: TransferRequest, name: string) => Promise<string>;
  cancel: (key: string) => void;
  retry: (key: string) => Promise<void>;
  dismiss: (key: string) => void;
  clearFinished: (sftpId: number) => void;
}

let counter = 0;

export const useTransfersStore = create<TransfersState>()((set, get) => {
  const update = (key: string, patch: Partial<TransferItem>) =>
    set((s) => ({ items: s.items.map((t) => (t.key === key ? { ...t, ...patch } : t)) }));

  const launch = async (key: string, request: TransferRequest) => {
    const channel = new Channel<TransferEvent>();
    channel.onmessage = (event) => update(key, { event });
    const result = await commands.sftpTransferStart(request, channel);
    if (result.status === "error") update(key, { event: { state: "failed", message: result.error.message } });
    else update(key, { transferId: result.data });
  };

  return {
    items: [],

    start: async (request, name) => {
      const key = `transfer-${counter++}`;
      set((s) => ({ items: [...s.items, { key, transferId: null, request, name, event: { state: "queued" } }] }));
      await launch(key, request);
      return key;
    },

    cancel: (key) => {
      const item = get().items.find((t) => t.key === key);
      if (item?.transferId != null && !isFinished(item.event)) void commands.sftpTransferCancel(item.transferId);
    },

    retry: async (key) => {
      const item = get().items.find((t) => t.key === key);
      if (!item || !isFinished(item.event) || item.event.state === "completed") return;
      update(key, { transferId: null, event: { state: "queued" } });
      await launch(key, item.request);
    },

    dismiss: (key) => set((s) => ({ items: s.items.filter((t) => t.key !== key || !isFinished(t.event)) })),

    clearFinished: (sftpId) =>
      set((s) => ({ items: s.items.filter((t) => t.request.sftpId !== sftpId || !isFinished(t.event)) })),
  };
});

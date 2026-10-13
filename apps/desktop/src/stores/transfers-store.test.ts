import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TransferEvent, TransferRequest } from "@/bindings";
import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
const commands = { sftpTransferStart: vi.fn(), sftpTransferCancel: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { measureRate, useTransfersStore } = await import("./transfers-store");

const request: TransferRequest = { sftpId: 1, direction: "upload", localPath: "/tmp/a", remotePath: "/srv/a" };
const ok = (data: unknown) => ({ status: "ok", data });
const lastChannel = () => FakeChannel.created.at(-1) as FakeChannel<TransferEvent>;
const item = (key: string) => useTransfersStore.getState().items.find((t) => t.key === key);

describe("transfers store", () => {
  beforeEach(() => {
    useTransfersStore.setState({ items: [] });
    FakeChannel.created = [];
    commands.sftpTransferStart.mockReset().mockResolvedValue(ok(7));
    commands.sftpTransferCancel.mockReset().mockResolvedValue(ok(true));
  });

  it("queues a transfer and follows its events", async () => {
    const key = await useTransfersStore.getState().start(request, "a");
    expect(item(key)).toMatchObject({ transferId: 7, name: "a", event: { state: "queued" } });

    lastChannel().emit({ state: "running", done: 5, total: 10, filesDone: 0, filesTotal: 1, current: "/srv/a" });
    expect(item(key)?.event).toMatchObject({ state: "running", done: 5 });
    lastChannel().emit({ state: "completed", bytes: 10 });
    expect(item(key)?.event).toEqual({ state: "completed", bytes: 10 });
  });

  it("measures a smoothed speed from readings at least half a second apart", () => {
    let item = { rate: null as number | null, sample: null as { at: number; done: number } | null };
    item = measureRate(item, 0, 0);
    expect(item).toEqual({ rate: null, sample: { at: 0, done: 0 } });
    expect(measureRate(item, 100, 100)).toBe(item);
    item = measureRate(item, 1000, 1000);
    expect(item.rate).toBe(1000);
    item = measureRate(item, 4000, 2000);
    expect(item.rate).toBeCloseTo(1000 * 0.7 + 3000 * 0.3);
    expect(measureRate(item, 10, 2600).sample).toEqual({ at: 2600, done: 10 });
  });

  it("tracks speed while running and drops it when finished", async () => {
    const now = vi.spyOn(Date, "now");
    const key = await useTransfersStore.getState().start(request, "a");
    now.mockReturnValue(1000);
    lastChannel().emit({ state: "running", done: 0, total: 10_000, filesDone: 0, filesTotal: 1, current: "" });
    now.mockReturnValue(2000);
    lastChannel().emit({ state: "running", done: 4000, total: 10_000, filesDone: 0, filesTotal: 1, current: "" });
    expect(item(key)?.rate).toBe(4000);
    lastChannel().emit({ state: "completed", bytes: 10_000 });
    expect(item(key)?.rate).toBeNull();
    now.mockRestore();
  });

  it("marks a transfer failed when it cannot be queued", async () => {
    commands.sftpTransferStart.mockResolvedValue({ status: "error", error: { code: "session_not_found", message: "gone" } });
    const key = await useTransfersStore.getState().start(request, "a");
    expect(item(key)?.event).toEqual({ state: "failed", message: "gone" });
  });

  it("cancels only unfinished transfers", async () => {
    const key = await useTransfersStore.getState().start(request, "a");
    useTransfersStore.getState().cancel(key);
    expect(commands.sftpTransferCancel).toHaveBeenCalledWith(7);

    lastChannel().emit({ state: "cancelled" });
    commands.sftpTransferCancel.mockClear();
    useTransfersStore.getState().cancel(key);
    expect(commands.sftpTransferCancel).not.toHaveBeenCalled();
  });

  it("retries a failed or cancelled transfer with the same request", async () => {
    const key = await useTransfersStore.getState().start(request, "a");
    await useTransfersStore.getState().retry(key);
    expect(commands.sftpTransferStart).toHaveBeenCalledTimes(1);

    lastChannel().emit({ state: "failed", message: "boom" });
    commands.sftpTransferStart.mockResolvedValue(ok(8));
    await useTransfersStore.getState().retry(key);
    expect(commands.sftpTransferStart).toHaveBeenLastCalledWith(request, expect.anything());
    expect(item(key)).toMatchObject({ transferId: 8, event: { state: "queued" } });
  });

  it("clears finished transfers of one session and keeps running ones", async () => {
    const done = await useTransfersStore.getState().start(request, "done");
    lastChannel().emit({ state: "completed", bytes: 1 });
    const running = await useTransfersStore.getState().start(request, "running");
    const other = await useTransfersStore.getState().start({ ...request, sftpId: 2 }, "other");
    lastChannel().emit({ state: "completed", bytes: 1 });

    useTransfersStore.getState().dismiss(running);
    useTransfersStore.getState().clearFinished(1);
    expect(useTransfersStore.getState().items.map((t) => t.key)).toEqual([running, other]);
    expect(item(done)).toBeUndefined();
  });
});

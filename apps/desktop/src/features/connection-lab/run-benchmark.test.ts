import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));

const commands = { benchmarkOutputRaw: vi.fn(), benchmarkOutputJson: vi.fn(), benchmarkAcknowledgeOutput: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { runBenchmark } = await import("./run-benchmark");

function fakeClock(...ticks: number[]) {
  return () => ticks.shift() ?? 0;
}

describe("runBenchmark", () => {
  beforeEach(() => {
    FakeChannel.created = [];
    commands.benchmarkOutputRaw.mockReset();
    commands.benchmarkOutputJson.mockReset();
    commands.benchmarkAcknowledgeOutput.mockReset();
  });

  it("waits until the terminal has rendered every byte before stopping the clock", async () => {
    const pendingWrites: (() => void)[] = [];
    const terminal = { write: vi.fn((_d: Uint8Array, done?: () => void) => done && pendingWrites.push(done)) };
    commands.benchmarkOutputRaw.mockImplementation(async () => {
      FakeChannel.created[0]?.emit(new Uint8Array(6).buffer);
      FakeChannel.created[0]?.emit(new Uint8Array(4).buffer);
      return { status: "ok", data: { totalBytes: 10, messages: 2, rustElapsedMs: 1 } };
    });

    const result = runBenchmark("raw", 10, terminal, fakeClock(100, 350));
    await Promise.resolve();
    await Promise.resolve();
    pendingWrites.forEach((done) => done());

    await expect(result).resolves.toEqual({ transport: "raw", totalBytes: 10, messages: 2, elapsedMs: 250 });
    expect(terminal.write).toHaveBeenCalledTimes(2);
    expect(commands.benchmarkAcknowledgeOutput.mock.calls).toEqual([[6], [4]]);
  });

  it("uses the JSON command and number-array payloads for the json transport", async () => {
    const terminal = { write: vi.fn((_d: Uint8Array, done?: () => void) => done?.()) };
    commands.benchmarkOutputJson.mockImplementation(async () => {
      FakeChannel.created[0]?.emit([1, 2, 3]);
      return { status: "ok", data: { totalBytes: 3, messages: 1, rustElapsedMs: 1 } };
    });

    const result = await runBenchmark("json", 3, terminal, fakeClock(0, 30));
    expect(result).toEqual({ transport: "json", totalBytes: 3, messages: 1, elapsedMs: 30 });
    expect(commands.benchmarkOutputRaw).not.toHaveBeenCalled();
  });

  it("does not acknowledge bytes the terminal has not rendered yet", async () => {
    commands.benchmarkOutputRaw.mockImplementation(async () => {
      FakeChannel.created[0]?.emit(new Uint8Array(5).buffer);
      return { status: "ok", data: { totalBytes: 5, messages: 1, rustElapsedMs: 1 } };
    });
    void runBenchmark("raw", 5, { write: vi.fn() });
    await Promise.resolve();
    expect(commands.benchmarkAcknowledgeOutput).not.toHaveBeenCalled();
  });

  it("rejects when the backend reports an error", async () => {
    commands.benchmarkOutputRaw.mockResolvedValue({ status: "error", error: null });
    await expect(runBenchmark("raw", 1, { write: vi.fn() })).rejects.toThrow("benchmark failed");
  });

  it("rejects when the backend call fails", async () => {
    commands.benchmarkOutputRaw.mockRejectedValue(new Error("no backend"));
    await expect(runBenchmark("raw", 1, { write: vi.fn() })).rejects.toThrow("no backend");
  });
});

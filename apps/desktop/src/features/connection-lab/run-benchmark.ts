import { Channel } from "@tauri-apps/api/core";

import { commands } from "@/bindings";
import { toBytes } from "@/features/terminal/to-bytes";

import type { ThroughputResult } from "./throughput";

export interface BenchmarkTerminal {
  write: (data: Uint8Array, onWritten?: () => void) => void;
}

/**
 * Streams `totalBytes` of sample output from Rust into the terminal and measures the time
 * until xterm has rendered the last byte, not just until IPC delivered it.
 */
export function runBenchmark(
  transport: "raw" | "json",
  totalBytes: number,
  terminal: BenchmarkTerminal,
  now: () => number = () => performance.now(),
): Promise<ThroughputResult> {
  return new Promise((resolve, reject) => {
    const started = now();
    let written = 0;
    let expected: number | null = null;
    let messages = 0;

    const finishIfDone = () => {
      if (expected !== null && written >= expected) {
        resolve({ transport, totalBytes: expected, messages, elapsedMs: now() - started });
      }
    };

    const channel = new Channel<number[]>();
    channel.onmessage = (payload) => {
      const bytes = toBytes(payload);
      terminal.write(bytes, () => {
        written += bytes.length;
        void commands.benchmarkAcknowledgeOutput(bytes.length);
        finishIfDone();
      });
    };

    const run = transport === "raw" ? commands.benchmarkOutputRaw : commands.benchmarkOutputJson;
    run(totalBytes, channel)
      .then((result) => {
        if (result.status === "error") throw new Error("benchmark failed in the backend");
        expected = result.data.totalBytes;
        messages = result.data.messages;
        finishIfDone();
      })
      .catch(reject);
  });
}

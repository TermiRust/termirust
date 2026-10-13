import { ArrowLeft, Gauge, Plug, PlugZap, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { commands } from "@/bindings";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TerminalView, type TerminalHandle } from "@/features/terminal/terminal-view";

import { parseConnectForm, type ConnectFormErrors, type ConnectFormValues } from "./connect-form";
import { runBenchmark } from "./run-benchmark";
import { describeThroughput } from "./throughput";
import { useSshSession } from "./use-ssh-session";

const BENCHMARK_BYTES = 100 * 1024 * 1024;

interface ConnectionLabProps {
  onExit: () => void;
  /** Runs every benchmark once on mount and reports results to the Rust console. */
  autoRunBenchmarks?: boolean;
}

const AUTORUN_SEQUENCE = ["raw", "json", "raw", "json"] as const;

export function ConnectionLab({ onExit, autoRunBenchmarks = false }: ConnectionLabProps) {
  const terminalRef = useRef<TerminalHandle>(null);
  const getTerminal = useCallback(() => terminalRef.current, []);
  const session = useSshSession(getTerminal);
  const [values, setValues] = useState<ConnectFormValues>({ host: "127.0.0.1", port: "2222", username: "", password: "" });
  const [errors, setErrors] = useState<ConnectFormErrors>({});
  const [results, setResults] = useState<string[]>([]);
  const [benchmarking, setBenchmarking] = useState(false);

  const connected = session.state.phase === "connected";
  const busy = session.state.phase === "connecting" || benchmarking;

  const field = (name: keyof ConnectFormValues) => ({
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
    "aria-invalid": errors[name] ? true : undefined,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseConnectForm(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    terminalRef.current?.clear();
    void session.connect(parsed.login);
  };

  const benchmark = useCallback(async (transport: "raw" | "json"): Promise<string | null> => {
    const terminal = terminalRef.current;
    if (!terminal) return null;
    setBenchmarking(true);
    terminal.clear();
    let line: string;
    try {
      line = describeThroughput(await runBenchmark(transport, BENCHMARK_BYTES, terminal));
    } catch (err) {
      line = `${transport.toUpperCase()}: failed — ${String(err)}`;
    } finally {
      setBenchmarking(false);
    }
    setResults((r) => [line, ...r]);
    return line;
  }, []);

  useEffect(() => {
    if (!autoRunBenchmarks) return;
    void (async () => {
      for (const transport of AUTORUN_SEQUENCE) {
        const line = await benchmark(transport);
        if (line) await commands.benchmarkReport(`${navigator.userAgent} | ${line}`);
      }
      await commands.benchmarkReport("done");
    })();
  }, [autoRunBenchmarks, benchmark]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        onSubmit={onSubmit}
        aria-label="Connect"
        className="flex flex-wrap items-end gap-2 border-b border-border p-3"
      >
        <Button type="button" size="icon" aria-label="Back" onClick={onExit}>
          <ArrowLeft size={15} />
        </Button>
        <LabeledInput label="Host" error={errors.host} className="w-44" {...field("host")} />
        <LabeledInput label="Port" error={errors.port} className="w-20" inputMode="numeric" {...field("port")} />
        <LabeledInput label="Username" error={errors.username} className="w-36" {...field("username")} />
        <LabeledInput label="Password" type="password" className="w-36" {...field("password")} />
        {connected ? (
          <Button type="button" variant="outline" onClick={() => void session.disconnect()}>
            <PlugZap size={15} /> Disconnect
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={busy}>
            <Plug size={15} /> {session.state.phase === "connecting" ? "Connecting…" : "Connect"}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" disabled={busy || connected} onClick={() => void benchmark("raw")}>
            <Gauge size={15} /> Benchmark raw
          </Button>
          <Button type="button" variant="outline" disabled={busy || connected} onClick={() => void benchmark("json")}>
            <Gauge size={15} /> Benchmark JSON
          </Button>
        </div>
      </form>

      <StatusLine state={session.state} />

      {session.state.phase === "confirmHostKey" && (
        <div role="alertdialog" aria-label="Verify host key" className="m-3 rounded-md border border-border bg-bg-elev p-4">
          <p className="flex items-center gap-2 font-medium">
            <ShieldAlert size={16} className="text-accent" /> Verify new server {values.host}:{values.port || "22"}
          </p>
          <p className="mt-1 font-mono text-xs text-fg-muted">
            {session.state.algorithm} {session.state.fingerprint}
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={session.rejectHostKey}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                session.state.phase === "confirmHostKey" &&
                void session.trustHostKeyAndConnect(session.state.fingerprint)
              }
            >
              Trust &amp; connect
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <TerminalView ref={terminalRef} onData={session.send} onResize={session.resize} />
      </div>

      {results.length > 0 && (
        <ul aria-label="Benchmark results" className="max-h-24 overflow-y-auto border-t border-border p-2 font-mono text-xs">
          {results.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusLine({ state }: { state: ReturnType<typeof useSshSession>["state"] }) {
  const text =
    state.phase === "error"
      ? state.message
      : state.phase === "closed"
        ? `Session closed${state.exitStatus === null ? "" : ` (exit ${state.exitStatus})`}`
        : state.phase === "connected"
          ? "Connected"
          : null;
  if (!text) return null;
  return (
    <p role="status" className={`px-3 py-1 text-xs ${state.phase === "error" ? "text-accent" : "text-fg-muted"}`}>
      {text}
    </p>
  );
}

interface LabeledInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

function LabeledInput({ label, error, className, ...props }: LabeledInputProps) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-fg-muted ${className ?? ""}`}>
      {label}
      <Input aria-label={label} {...props} />
      {error && <span className="text-accent">{error}</span>}
    </label>
  );
}

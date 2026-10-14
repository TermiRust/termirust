import { Clock, Cpu, Loader2, HardDrive, KeyRound, MemoryStick, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";

import type { HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { EnvironmentBadge } from "@/components/ui/environment-badge";
import { OsIcon } from "@/components/ui/os-icon";
import { StatusDot, type DotState } from "@/components/ui/status-dot";
import { CredentialsPrompt } from "@/features/session/credentials-prompt";
import { HostKeyDialog } from "@/features/session/host-key-dialog";
import { credentialsRequestOf, isHostPrompt } from "@/features/session/host-prompt";
import { cn } from "@/lib/utils";

import { diskUsage, formatKb, formatLoad, formatUptime, levelOf, memoryUsage, swapUsage } from "./format";
import { useHostStats, type HostStatsState } from "./use-host-stats";

function dotOf(state: HostStatsState): DotState {
  if (state.phase === "live") return "on";
  if (state.phase === "loading") return "warn";
  if (state.phase === "error") return "err";
  return "idle";
}

function Meter({ icon, label, value, detail, percent }: { icon: ReactNode; label: string; value: string; detail?: string | null; percent: number }) {
  const level = levelOf(percent);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[12px]">
        <span className="text-fg-muted" aria-hidden>
          {icon}
        </span>
        <span className="font-medium">{label}</span>
        <span className="ml-auto font-mono tabular-nums">{value}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="h-1.5 overflow-hidden rounded-full bg-hover"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", level === "ok" && "bg-ok", level === "warn" && "bg-warn", level === "crit" && "bg-danger")}
          style={{ width: `${Math.max(percent, 1)}%` }}
        />
      </div>
      {detail && <span className="truncate font-mono text-[11px] text-fg-muted">{detail}</span>}
    </div>
  );
}

interface MonitorCardProps {
  host: HostView;
  onRemove: () => void;
}

/** One watched host: live CPU, memory and disk, refreshed every 10 seconds. */
export function MonitorCard({ host, onRemove }: MonitorCardProps) {
  const { state, refreshing, refresh, submitCredentials, trustHostKey, cancel } = useHostStats(host.id);
  const stats = state.phase === "live" ? state.stats : null;
  const credentials = credentialsRequestOf(state);
  const endpoint = `${host.hostname}:${host.port}`;
  const memory = stats && memoryUsage(stats);
  const swap = stats && swapUsage(stats);
  const disk = stats && diskUsage(stats);
  const load = stats && formatLoad(stats.load);

  return (
    <article aria-label={`Monitor ${host.label}`} className="flex flex-col gap-3 rounded-xl border border-border bg-bg-elev p-4">
      <header className="flex items-start gap-2.5">
        <OsIcon os={stats?.osId ?? host.os} size={22} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusDot state={dotOf(state)} />
            <h2 className="truncate text-[14px] font-semibold">{host.label}</h2>
            <EnvironmentBadge environment={host.environment} />
          </div>
          <p className="truncate font-mono text-[11px] text-fg-muted" title={stats?.addresses.join(", ")}>
            {stats?.hostname ? `${stats.hostname} · ` : ""}
            {stats && stats.addresses.length > 0 ? stats.addresses.join(", ") : host.hostname}
          </p>
        </div>
        <Button size="icon" aria-label={`Refresh ${host.label}`} onClick={refresh} disabled={refreshing || isHostPrompt(state)}>
          <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button size="icon" aria-label={`Stop monitoring ${host.label}`} onClick={onRemove}>
          <X size={14} />
        </Button>
      </header>

      {state.phase === "loading" && (
        <p role="status" className="flex items-center justify-center gap-1.5 py-6 text-[12px] text-fg-muted">
          <Loader2 size={14} className="animate-spin text-accent" aria-hidden /> Connecting…
        </p>
      )}
      {state.phase === "error" && (
        <div role="alert" className="flex flex-col items-center gap-2 py-4 text-center text-[12px] text-danger">
          <span className="line-clamp-3 break-words">{state.message}</span>
          <Button size="sm" variant="outline" onClick={refresh}>
            Try again
          </Button>
        </div>
      )}
      {(state.phase === "cancelled" || isHostPrompt(state)) && (
        <div className="flex flex-col items-center gap-2 py-4 text-center text-[12px] text-fg-muted">
          <span>{state.phase === "cancelled" ? "Login cancelled." : "Waiting for login…"}</span>
          {state.phase === "cancelled" && (
            <Button size="sm" variant="outline" onClick={refresh}>
              <KeyRound size={13} /> Log in
            </Button>
          )}
        </div>
      )}

      {stats && (
        <>
          <div className="flex flex-col gap-3">
            {stats.cpuPercent !== null && (
              <Meter
                icon={<Cpu size={13} />}
                label="CPU"
                value={`${stats.cpuPercent.toFixed(0)}%`}
                percent={stats.cpuPercent}
                detail={[stats.cpuCount !== null ? `${stats.cpuCount} cores` : null, load ? `load ${load}` : null].filter(Boolean).join(" · ")}
              />
            )}
            {memory && (
              <Meter
                icon={<MemoryStick size={13} />}
                label="Memory"
                value={`${formatKb(memory.used)} / ${formatKb(memory.total)}`}
                percent={memory.percent}
                detail={swap && swap.total > 0 ? `swap ${formatKb(swap.used)} / ${formatKb(swap.total)}` : null}
              />
            )}
            {disk && (
              <Meter
                icon={<HardDrive size={13} />}
                label={`Disk ${stats.diskMount ?? "/"}`}
                value={`${formatKb(disk.used)} / ${formatKb(disk.total)}`}
                percent={disk.percent}
                detail={`${formatKb(disk.total - disk.used)} free`}
              />
            )}
          </div>

          {stats.topProcesses.length > 0 && (
            <table aria-label="Top processes" className="w-full table-fixed font-mono text-[11px]">
              <thead className="text-fg-muted">
                <tr>
                  <th className="text-left font-normal">Process</th>
                  <th className="w-12 text-right font-normal">CPU</th>
                  <th className="w-12 text-right font-normal">MEM</th>
                </tr>
              </thead>
              <tbody>
                {stats.topProcesses.map((p, i) => (
                  <tr key={`${p.command}-${i}`}>
                    <td className="truncate" title={p.command}>
                      {p.command}
                    </td>
                    <td className="text-right tabular-nums">{(p.cpuPercent ?? 0).toFixed(1)}%</td>
                    <td className="text-right tabular-nums">{(p.memPercent ?? 0).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-fg-muted">
            {stats.uptimeSecs !== null && (
              <span className="flex items-center gap-1">
                <Clock size={11} aria-hidden /> up {formatUptime(stats.uptimeSecs)}
              </span>
            )}
            {stats.osName && <span className="truncate">{stats.osName}</span>}
            {stats.kernel && (
              <span className="truncate font-mono" title={stats.kernel}>
                {stats.kernel}
              </span>
            )}
          </footer>
        </>
      )}

      {credentials && (
        <CredentialsPrompt key={state.phase} hostLabel={host.label} endpoint={endpoint} request={credentials} onSubmit={submitCredentials} onCancel={cancel} />
      )}
      {(state.phase === "hostKeyUnknown" || state.phase === "hostKeyChanged") && (
        <HostKeyDialog
          endpoint={state.server}
          algorithm={state.algorithm}
          fingerprint={state.fingerprint}
          previousFingerprint={state.phase === "hostKeyChanged" ? state.previousFingerprint : undefined}
          onTrust={(remember) => trustHostKey(state.fingerprint, remember)}
          onCancel={cancel}
        />
      )}
    </article>
  );
}

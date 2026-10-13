import { RotateCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { AutoReconnect } from "./use-auto-reconnect";
import type { HostSessionState } from "./use-host-session";

interface ConnectionBannerProps {
  state: HostSessionState;
  recovering: boolean;
  auto: AutoReconnect;
  onReconnect: () => void;
}

/** Explains why a tab is not connected and how it will (or can) come back. */
export function ConnectionBanner({ state, recovering, auto, onReconnect }: ConnectionBannerProps) {
  if (state.phase === "connected" || (state.phase === "connecting" && !recovering)) return null;
  if (state.phase === "needsPassword" || state.phase === "needsPassphrase" || state.phase === "needsUsername") return null;
  if (state.phase === "hostKeyUnknown" || state.phase === "hostKeyChanged") return null;

  let message: string;
  let tone: "warn" | "muted" | "danger" = "muted";
  let actions: React.ReactNode = (
    <Button size="sm" variant="outline" onClick={onReconnect}>
      <RotateCw size={13} /> Reconnect
    </Button>
  );

  if (state.phase === "connecting") {
    message = "Reconnecting…";
    tone = "warn";
    actions = null;
  } else if (recovering && auto.secondsLeft !== null) {
    message = `Connection lost. Reconnecting in ${auto.secondsLeft}s (attempt ${auto.attempt} of ${auto.attempt + auto.attemptsLeft - 1})`;
    tone = "warn";
    actions = (
      <>
        <Button size="sm" variant="outline" onClick={auto.retryNow}>
          <RotateCw size={13} /> Reconnect now
        </Button>
        <Button size="sm" variant="ghost" onClick={auto.cancel}>
          Cancel
        </Button>
      </>
    );
  } else if (state.phase === "error") {
    message = recovering ? `Still unreachable: ${state.message}` : state.message;
    tone = "danger";
  } else if (state.phase === "closed" && state.reason === "exited") {
    message = `Session ended${state.exitStatus === null ? "" : ` (exit ${state.exitStatus})`}`;
  } else if (state.phase === "closed" && state.reason === "lost") {
    message = "Connection lost.";
    tone = "warn";
  } else if (state.phase === "cancelled") {
    message = "Not connected";
  } else {
    message = "Disconnected";
  }

  return (
    <div
      role="status"
      className={cn(
        "flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[13px]",
        tone === "warn" && "border-warn/40 bg-warn-soft text-fg",
        tone === "danger" && "border-danger-border bg-danger-soft text-danger",
        tone === "muted" && "border-border bg-bg-sunk text-fg-muted",
      )}
    >
      {tone !== "muted" && <WifiOff size={14} className="shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </div>
  );
}

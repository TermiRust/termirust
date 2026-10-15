import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, Loader2, ShieldAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { PROJECT } from "@/lib/project";
import { useUpdateStore } from "@/stores/update-store";

function InstallButton({ label = "Install & restart" }: { label?: string }) {
  const phase = useUpdateStore((s) => s.phase);
  const progress = useUpdateStore((s) => s.progress);
  const install = useUpdateStore((s) => s.install);
  const busy = phase === "downloading" || phase === "installing";
  return (
    <Button size="sm" variant="primary" onClick={() => void install()} disabled={busy}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      {phase === "installing" ? "Installing…" : phase === "downloading" ? `Downloading${progress !== null ? ` ${Math.round(progress * 100)}%` : "…"}` : label}
    </Button>
  );
}

/**
 * A slim banner when a new version is out, or a dialog that cannot be dismissed when the
 * running version is below the release's required minimum.
 */
export function UpdateNotice() {
  const available = useUpdateStore((s) => s.available);
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion);
  const error = useUpdateStore((s) => s.error);
  const phase = useUpdateStore((s) => s.phase);
  const dismiss = useUpdateStore((s) => s.dismiss);
  if (!available) return null;

  if (available.required) {
    return (
      <Dialog
        open
        dismissible={false}
        onOpenChange={() => {}}
        tone="danger"
        width="sm"
        icon={<ShieldAlert size={16} />}
        title="Update required"
        description={`Termirust ${available.currentVersion} has a problem fixed in ${available.version}. Install the update to keep using the app.`}
      >
        {available.notes && <p className="max-h-40 overflow-y-auto text-[12px] whitespace-pre-wrap text-fg-2">{available.notes}</p>}
        {phase === "error" && error && (
          <p role="alert" className="mt-2 text-[12px] text-danger">
            {error}
          </p>
        )}
        <p className="mt-2 text-[11px] text-fg-muted">Open sessions will be closed when the app restarts.</p>
        <DialogFooter className="justify-end">
          <Button size="sm" variant="outline" onClick={() => void openUrl(PROJECT.releaseUrl(available.version))}>
            Release notes
          </Button>
          <InstallButton label={phase === "error" ? "Try again" : "Install & restart"} />
        </DialogFooter>
      </Dialog>
    );
  }

  if (dismissedVersion === available.version) return null;
  return (
    <div role="status" aria-label="Update available" className="flex shrink-0 items-center gap-3 border-b border-border bg-accent-soft px-3 py-1.5 text-[12.5px]">
      <Download size={14} className="text-accent" aria-hidden />
      <span className="flex-1">
        <b>Termirust {available.version}</b> is available — you have {available.currentVersion}. Restarting closes open sessions.
        {phase === "error" && error && <span className="ml-2 text-danger">{error}</span>}
      </span>
      <Button size="sm" variant="ghost" onClick={() => void openUrl(PROJECT.releaseUrl(available.version))}>
        What&apos;s new
      </Button>
      <InstallButton />
      <Button size="icon" aria-label="Remind me later" title="Later" onClick={dismiss}>
        <X size={14} />
      </Button>
    </div>
  );
}

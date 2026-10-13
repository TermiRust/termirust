import { ShieldAlert, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

interface HostKeyDialogProps {
  endpoint: string;
  algorithm: string;
  fingerprint: string;
  /** Present when the server's key differs from the one trusted before. */
  previousFingerprint?: string;
  onTrust: () => void;
  onCancel: () => void;
}

export function HostKeyDialog({ endpoint, algorithm, fingerprint, previousFingerprint, onTrust, onCancel }: HostKeyDialogProps) {
  const changed = previousFingerprint !== undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={changed ? "Host key has changed" : "Verify new server"}
      description={
        changed
          ? `The key presented by ${endpoint} is not the one you trusted before. Someone may be intercepting the connection.`
          : `First connection to ${endpoint}. Check the fingerprint with the server administrator if you can.`
      }
    >
      <div className={`rounded-md border p-3 ${changed ? "border-red-500/60 bg-red-500/10" : "border-border bg-bg-elev"}`}>
        <p className="flex items-center gap-2 text-sm font-medium">
          {changed ? <ShieldAlert size={16} className="text-red-500" /> : <ShieldQuestion size={16} className="text-accent" />}
          {algorithm}
        </p>
        {changed && <p className="mt-2 font-mono text-xs break-all text-fg-muted">Previous: {previousFingerprint}</p>}
        <p className="mt-1 font-mono text-xs break-all">{changed ? `Now: ${fingerprint}` : fingerprint}</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant={changed ? "primary" : "outline"} onClick={onCancel} autoFocus={changed}>
          Cancel
        </Button>
        <Button variant={changed ? "outline" : "primary"} onClick={onTrust}>
          {changed ? "I understand, update the key" : "Trust & connect"}
        </Button>
      </div>
    </Dialog>
  );
}

import { Check, Copy, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

interface HostKeyDialogProps {
  endpoint: string;
  algorithm: string;
  fingerprint: string;
  /** Present when the server's key differs from the one trusted before. */
  previousFingerprint?: string;
  /** `remember` is false for "connect once without saving". */
  onTrust: (remember: boolean) => void;
  onCancel: () => void;
}

function CopyFingerprint({ fingerprint }: { fingerprint: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
      onClick={() =>
        void navigator.clipboard.writeText(fingerprint).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy fingerprint"}
    </button>
  );
}

export function HostKeyDialog({ endpoint, algorithm, fingerprint, previousFingerprint, onTrust, onCancel }: HostKeyDialogProps) {
  const changed = previousFingerprint !== undefined;
  const [verified, setVerified] = useState(false);

  return (
    <Dialog
      open
      width="md"
      tone={changed ? "danger" : "default"}
      icon={changed ? <ShieldAlert size={16} /> : <ShieldQuestion size={16} />}
      onOpenChange={(open) => !open && onCancel()}
      title={changed ? "Host key has changed" : "Verify new server"}
      description={changed ? `${endpoint} — connection blocked` : `First connection to ${endpoint}`}
    >
      <p className="text-[13px] text-fg-2">
        {changed
          ? "The server presented a different key than the one you trusted. Someone may be intercepting the connection, or the server was reinstalled."
          : "Check that this fingerprint matches the one from your server admin or cloud console."}
      </p>
      <div className={`mt-3 rounded-md border p-3 ${changed ? "border-danger-border bg-danger-soft" : "border-border bg-bg-sunk"}`}>
        {changed && (
          <>
            <p className="text-xs text-fg-muted">Saved key · {algorithm}</p>
            <p className="font-mono text-xs break-all text-fg-muted line-through">{previousFingerprint}</p>
            <p className="mt-2 text-xs text-fg-muted">Received now · {algorithm}</p>
          </>
        )}
        {!changed && <p className="text-xs text-fg-muted">{algorithm}</p>}
        <p className={`font-mono text-[13px] break-all select-text ${changed ? "text-danger" : ""}`}>{fingerprint}</p>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <CopyFingerprint fingerprint={fingerprint} />
        {!changed && (
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => onTrust(false)}>
            Connect once without saving
          </button>
        )}
      </div>
      {changed && (
        <Checkbox
          className="mt-3"
          label="I verified the new fingerprint with the server owner"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
        />
      )}
      <DialogFooter className="justify-end">
        {changed ? (
          <>
            <Button variant="danger" disabled={!verified} onClick={() => onTrust(true)}>
              I understand, update the key
            </Button>
            <Button variant="primary" onClick={onCancel} autoFocus>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => onTrust(true)} autoFocus>
              Trust & connect
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

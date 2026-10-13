import { Check, Copy, KeyRound, Lock, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { KeyView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useKeysStore } from "@/stores/keys-store";

import { ImportKeyDialog } from "./import-key-dialog";

export function KeychainView() {
  const { keys, loaded, error, load } = useKeysStore();
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="Keychain" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <KeyRound size={16} className="text-fg-muted" />
        <h1 className="text-[15px] font-semibold">Keychain</h1>
        <span className="text-xs text-fg-muted">SSH keys stored encrypted in your vault</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setGenerating(true)}>
            <Sparkles size={14} /> Generate key
          </Button>
          <Button variant="primary" size="sm" onClick={() => setImporting(true)}>
            <Plus size={14} /> Import key
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {loaded && keys.length === 0 && !error && (
          <div className="mx-auto mt-16 max-w-sm text-center text-fg-muted">
            <p className="text-fg">No keys yet</p>
            <p className="mt-1 text-[13px]">Import an existing key such as ~/.ssh/id_ed25519, or generate a new one.</p>
          </div>
        )}
        <ul aria-label="Keys" className="grid gap-2">
          {keys.map((key) => (
            <KeyRow key={key.id} keyView={key} />
          ))}
        </ul>
      </div>
      <ImportKeyDialog open={importing} onOpenChange={setImporting} />
      <GenerateKeyDialog open={generating} onOpenChange={setGenerating} />
    </section>
  );
}

function CopyPublicKey({ publicKey }: { publicKey: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(publicKey).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy public key"}
    </Button>
  );
}

function KeyRow({ keyView }: { keyView: KeyView }) {
  const remove = useKeysStore((s) => s.remove);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    if (!confirming) return setConfirming(true);
    const result = await remove(keyView.id);
    if (result.status === "error") {
      setError(result.error.message);
      setConfirming(false);
    }
  };

  return (
    <li aria-label={keyView.label} className="rounded-lg border border-border bg-bg-elev p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-sunk text-fg-muted">
          <KeyRound size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium">
            {keyView.label}
            <span className="rounded border border-border px-1.5 font-mono text-[11px] text-fg-muted uppercase">{keyView.keyType}</span>
            {keyView.encrypted && (
              <span className="flex items-center gap-1 text-xs text-fg-muted" title={keyView.hasSavedPassphrase ? "Passphrase saved" : "Asks for its passphrase"}>
                <Lock size={11} /> {keyView.hasSavedPassphrase ? "passphrase saved" : "passphrase"}
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">{keyView.fingerprint}</p>
          <p className="mt-1 text-xs text-fg-muted">
            {keyView.usedBy.length > 0 ? `Used by ${keyView.usedBy.join(", ")}` : "Not used by any host"}
          </p>
          {error && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <CopyPublicKey publicKey={keyView.publicKey} />
          <Button size="sm" variant={confirming ? "danger" : "ghost"} aria-label={`Delete ${keyView.label}`} onClick={() => void onDelete()} onBlur={() => setConfirming(false)}>
            <Trash2 size={13} /> {confirming ? "Confirm" : null}
          </Button>
        </div>
      </div>
    </li>
  );
}

function GenerateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Generate ed25519 key" icon={<Sparkles size={15} />} description="A new key pair is created and stored in your vault.">
      <GenerateKeyForm onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

function GenerateKeyForm({ onClose }: { onClose: () => void }) {
  const generate = useKeysStore((s) => s.generate);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<KeyView | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (created) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px]">Add this public key to <span className="font-mono">~/.ssh/authorized_keys</span> on your servers:</p>
        <pre className="max-h-28 overflow-auto rounded-md border border-border bg-bg-sunk p-2 font-mono text-xs break-all whitespace-pre-wrap select-text">{created.publicKey}</pre>
        <DialogFooter className="justify-end">
          <CopyPublicKey publicKey={created.publicKey} />
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await generate(label);
        if (result.status === "error") setError(result.error.message);
        else setCreated(result.data);
      }}
    >
      <Field label="Name" hint="Also used as the key comment" error={error ?? undefined}>
        <Input aria-label="Name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="deploy@laptop" autoFocus />
      </Field>
      <DialogFooter className="justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Generate
        </Button>
      </DialogFooter>
    </form>
  );
}

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FileKey, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { CommandError, KeyView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useKeysStore } from "@/stores/keys-store";

type Source = "file" | "paste";
type Result = { status: "ok"; data: KeyView } | { status: "error"; error: CommandError };

interface ImportKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (key: KeyView) => void;
}

export function ImportKeyDialog({ open, onOpenChange, onImported }: ImportKeyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Import private key" icon={<KeyRound size={15} />} description="OpenSSH, PEM or PuTTY format. Stored encrypted in your vault.">
      <ImportKeyForm
        onClose={() => onOpenChange(false)}
        onImported={(key) => {
          onImported?.(key);
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

const friendly: Partial<Record<CommandError["code"], string>> = {
  passphrase_required: "This key is encrypted. Enter its passphrase.",
  wrong_passphrase: "That passphrase is not correct.",
};

function ImportKeyForm({ onClose, onImported }: { onClose: () => void; onImported: (key: KeyView) => void }) {
  const { importText, importFile } = useKeysStore();
  const [source, setSource] = useState<Source>("file");
  const [path, setPath] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chooseFile = async () => {
    const picked = await openFileDialog({ multiple: false, directory: false, title: "Choose a private key" });
    if (typeof picked === "string") setPath(picked);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (source === "file" && !path) return setError("Choose a key file");
    if (source === "paste" && !text.trim()) return setError("Paste the private key");
    setError(null);
    setBusy(true);
    const options = { label, passphrase: passphrase || null, rememberPassphrase: remember && passphrase !== "" };
    const result: Result = source === "file" && path ? await importFile(path, options) : await importText(text, options);
    setBusy(false);
    if (result.status === "error") setError(friendly[result.error.code] ?? result.error.message);
    else onImported(result.data);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <SegmentedControl
        label="Key source"
        value={source}
        onChange={setSource}
        options={[
          { value: "file", label: "Choose file" },
          { value: "paste", label: "Paste text" },
        ]}
      />
      {source === "file" ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void chooseFile()}>
            <FileKey size={14} /> Choose…
          </Button>
          <span className="truncate font-mono text-xs text-fg-muted" title={path ?? undefined}>
            {path ?? "No file chosen (e.g. ~/.ssh/id_ed25519)"}
          </span>
        </div>
      ) : (
        <Field label="Private key">
          <textarea
            aria-label="Private key"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            className="h-28 resize-none rounded-md border border-border-strong bg-bg-elev px-2.5 py-2 font-mono text-xs text-fg"
          />
        </Field>
      )}
      <Field label="Name" hint="Defaults to the file name">
        <Input aria-label="Name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop ed25519" />
      </Field>
      <Field label="Passphrase" hint="Only if the key is encrypted">
        <Input aria-label="Passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </Field>
      {passphrase && <Checkbox label="Remember passphrase in vault" checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <DialogFooter className="justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Importing…" : "Import"}
        </Button>
      </DialogFooter>
    </form>
  );
}

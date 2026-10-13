import { AlertTriangle, FileInput, KeyRound, Route } from "lucide-react";
import { useEffect, useState } from "react";

import { commands, type SshConfigImportResult, type SshConfigPreview } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { useHostsStore } from "@/stores/hosts-store";
import { useKeysStore } from "@/stores/keys-store";

interface ImportSshConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportSshConfigDialog({ open, onOpenChange }: ImportSshConfigDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import from SSH config"
      icon={<FileInput size={15} />}
      width="lg"
      description="Hosts and the keys they use are copied into your encrypted vault. The file itself is not changed."
    >
      <ImportSshConfig onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; preview: SshConfigPreview };

function ImportSshConfig({ onClose }: { onClose: () => void }) {
  const reloadHosts = useHostsStore((s) => s.load);
  const reloadKeys = useKeysStore((s) => s.load);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<SshConfigImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void commands.sshConfigPreview(null).then((r) => {
      if (cancelled) return;
      if (r.status === "error") {
        setLoad({ status: "error", message: r.error.message });
      } else {
        setLoad({ status: "ready", preview: r.data });
        setSelected(new Set(r.data.candidates.filter((c) => !c.alreadySaved).map((c) => c.alias)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (alias: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });

  const runImport = async () => {
    if (load.status !== "ready") return;
    setImporting(true);
    const ordered = load.preview.candidates.map((c) => c.alias).filter((a) => selected.has(a));
    const r = await commands.sshConfigImport(load.preview.path, ordered);
    setImporting(false);
    if (r.status === "error") {
      setImportError(r.error.message);
      return;
    }
    setResult(r.data);
    await Promise.all([reloadHosts(), reloadKeys()]);
  };

  if (result) {
    return (
      <div className="flex flex-col gap-2 text-[13px]">
        <p role="status">
          Imported {result.createdHosts.length} host{result.createdHosts.length === 1 ? "" : "s"}
          {result.importedKeys.length > 0 && ` and ${result.importedKeys.length} key${result.importedKeys.length === 1 ? "" : "s"}`}.
        </p>
        {result.skipped.length > 0 && (
          <ul aria-label="Skipped hosts" className="list-disc pl-5 text-fg-muted">
            {result.skipped.map((s) => (
              <li key={s.alias}>
                {s.alias}: {s.reason}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  if (load.status === "loading") return <p className="text-[13px] text-fg-muted">Reading ~/.ssh/config…</p>;
  if (load.status === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-[13px] text-danger">
          {load.message}
        </p>
        <DialogFooter className="justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const { preview } = load;
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-xs text-fg-muted">{preview.path}</p>
      {preview.candidates.length === 0 ? (
        <p className="text-[13px] text-fg-muted">No concrete hosts found (wildcard-only blocks are skipped).</p>
      ) : (
        <ul aria-label="Hosts in config" className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {preview.candidates.map((c) => (
            <li key={c.alias}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-hover">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-accent"
                  aria-label={c.alias}
                  checked={selected.has(c.alias)}
                  onChange={() => toggle(c.alias)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{c.alias}</span>
                    {c.alreadySaved && <span className="rounded bg-bg-sunk px-1.5 text-[11px] text-fg-muted">already saved</span>}
                  </span>
                  <span className="block truncate font-mono text-xs text-fg-muted">
                    {c.user ? `${c.user}@` : ""}
                    {c.hostname}
                    {c.port !== 22 ? `:${c.port}` : ""}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-muted">
                    <span className="flex items-center gap-1">
                      <KeyRound size={11} /> {c.identityFiles.length > 0 ? c.identityFiles.map((f) => f.split("/").pop()).join(", ") : "default key or agent"}
                    </span>
                    {c.proxyJump && (
                      <span className="flex items-center gap-1">
                        <Route size={11} /> via {c.proxyJump}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {preview.unsupported.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-border bg-warn-soft p-2 text-xs text-fg-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
          Not applied yet: {preview.unsupported.join(", ")}. Those settings stay in your SSH config.
        </p>
      )}
      {importError && (
        <p role="alert" className="text-[13px] text-danger">
          {importError}
        </p>
      )}
      <DialogFooter className="justify-end">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={selected.size === 0 || importing} onClick={() => void runImport()}>
          {importing ? "Importing…" : `Import ${selected.size} host${selected.size === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}

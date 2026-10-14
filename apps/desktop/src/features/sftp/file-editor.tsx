import { FileText, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

import type { FileSource } from "./file-source";

interface FileEditorProps {
  source: FileSource;
  path: string;
  /** "prod-api" or "This Mac", shown in the title. */
  where: string;
  onClose: () => void;
  onSaved?: () => void;
}

type Load = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; original: string };

/** Edits a small text file in place (local or on the server); ⌘S / Ctrl+S saves. */
export function FileEditor({ source, path, where, onClose, onSaved }: FileEditorProps) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

  useEffect(() => {
    let live = true;
    source.readText(path).then(
      (content) => {
        if (!live) return;
        setText(content);
        setLoad({ phase: "ready", original: content });
      },
      (err: unknown) => live && setLoad({ phase: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [source, path]);

  const dirty = load.phase === "ready" && text !== load.original;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await source.writeText(path, text);
      setLoad({ phase: "ready", original: text });
      onSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  return (
    <Dialog
      open
      width="xl"
      onOpenChange={(open) => !open && requestClose()}
      title={`${dirty ? "● " : ""}${name}`}
      description={`${where} · ${path}`}
      icon={<FileText size={16} />}
    >
      {load.phase === "loading" && (
        <p role="status" className="flex h-[60vh] items-center justify-center gap-2 text-[13px] text-fg-muted">
          <Loader2 size={16} className="animate-spin text-accent" aria-hidden /> Opening {name}…
        </p>
      )}
      {load.phase === "error" && (
        <p role="alert" className="py-6 text-center text-[13px] text-danger">
          {load.message}
        </p>
      )}
      {load.phase === "ready" && (
        <textarea
          aria-label={`Contents of ${name}`}
          value={text}
          autoFocus
          spellCheck={false}
          wrap="off"
          onChange={(e) => {
            setText(e.target.value);
            setConfirmDiscard(false);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              void save();
            } else if (e.key === "Tab" && !e.shiftKey) {
              // Insert a tab instead of leaving the editor.
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: start, selectionEnd: end } = el;
              setText(text.slice(0, start) + "\t" + text.slice(end));
              requestAnimationFrame(() => el.setSelectionRange(start + 1, start + 1));
            }
          }}
          className="h-[60vh] w-full resize-none rounded-md border border-border bg-bg-sunk p-3 font-mono text-[12.5px] leading-5 outline-none focus:border-accent"
        />
      )}
      {saveError && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          Could not save: {saveError}
        </p>
      )}
      <DialogFooter className="items-center justify-end">
        {confirmDiscard ? (
          <>
            <span className="mr-auto text-[12px] text-warn">Discard unsaved changes?</span>
            <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={onClose}>
              Discard
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto text-[11px] text-fg-muted">{dirty ? "Unsaved changes · ⌘S / Ctrl+S to save" : "Saved"}</span>
            <Button variant="outline" onClick={requestClose}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

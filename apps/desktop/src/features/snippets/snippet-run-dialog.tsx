import { CornerDownLeft, Play, SquareCode, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { commands, type SnippetView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { canInsert, snippetKeystrokes } from "./keystrokes";
import { fillVariables, parseVariables } from "./variables";

interface SnippetRunDialogProps {
  snippet: SnippetView;
  /** Where it will be typed, e.g. the tab title. */
  targetLabel: string;
  onSend: (keystrokes: string) => void;
  onClose: () => void;
}

/** Fill in variables, see the final command, then insert it or run it. */
export function SnippetRunDialog({ snippet, targetLabel, onSend, onClose }: SnippetRunDialogProps) {
  const variables = parseVariables(snippet.command);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(variables.map((v) => [v.name, v.defaultValue])));
  const [danger, setDanger] = useState<{ command: string; reason: string | null } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const command = fillVariables(snippet.command, values);
  const missing = variables.filter((v) => !values[v.name]?.trim()).map((v) => v.name);
  const reason = danger?.command === command ? danger.reason : null;

  useEffect(() => {
    let current = true;
    void commands.commandDanger(command).then((result) => current && setDanger({ command, reason: result }));
    return () => {
      current = false;
    };
  }, [command]);

  const send = (run: boolean) => {
    onSend(snippetKeystrokes(command, run));
    onClose();
  };

  return (
    <Dialog open width="md" title={`Run ${snippet.name}`} description={`In ${targetLabel}`} icon={<SquareCode size={15} />} onOpenChange={(open) => !open && onClose()}>
      <form
        aria-label="Run snippet"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canInsert(command)) send(false);
        }}
      >
        {variables.map((v, index) => (
          <Field key={v.name} label={v.name}>
            <Input
              aria-label={v.name}
              value={values[v.name] ?? ""}
              autoFocus={index === 0}
              spellCheck={false}
              onChange={(e) => {
                setConfirmed(false);
                setValues((current) => ({ ...current, [v.name]: e.target.value }));
              }}
            />
          </Field>
        ))}
        <pre aria-label="Command to send" className="max-h-48 overflow-auto rounded border border-border bg-bg-sunk p-2 font-mono text-[12px] whitespace-pre-wrap">
          {command}
        </pre>
        {missing.length > 0 && <p className="text-xs text-fg-muted">Still empty: {missing.join(", ")}</p>}
        {reason && (
          <div role="alert" className="flex flex-col gap-1.5 rounded-md border border-danger-border bg-danger-soft p-2 text-xs text-danger">
            <span className="flex items-center gap-1.5">
              <TriangleAlert size={13} /> This command {reason}.
            </span>
            <label className="flex items-center gap-2 text-fg">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="accent-accent" />I checked it and want to run it
            </label>
          </div>
        )}
        <DialogFooter className="justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {canInsert(command) ? (
            <Button type="submit" variant="outline">
              <CornerDownLeft size={13} /> Insert
            </Button>
          ) : (
            <span className="text-[11px] text-fg-muted">Multi-line snippets run line by line.</span>
          )}
          <Button variant={reason ? "danger" : "primary"} disabled={Boolean(reason) && !confirmed} onClick={() => send(true)} autoFocus={variables.length === 0}>
            <Play size={13} /> Run
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

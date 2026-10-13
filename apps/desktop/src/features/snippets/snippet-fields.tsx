import { TriangleAlert } from "lucide-react";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import type { SnippetCommand } from "./use-snippet-command";

/** Variable inputs, the final command, and the danger confirmation. */
export function SnippetFields({ form, autoFocus = true }: { form: SnippetCommand; autoFocus?: boolean }) {
  return (
    <>
      {form.variables.map((v, index) => (
        <Field key={v.name} label={v.name}>
          <Input aria-label={v.name} value={form.values[v.name] ?? ""} autoFocus={autoFocus && index === 0} spellCheck={false} onChange={(e) => form.setValue(v.name, e.target.value)} />
        </Field>
      ))}
      <pre aria-label="Command to send" className="max-h-48 overflow-auto rounded border border-border bg-bg-sunk p-2 font-mono text-[12px] whitespace-pre-wrap">
        {form.command}
      </pre>
      {form.missing.length > 0 && <p className="text-xs text-fg-muted">Still empty: {form.missing.join(", ")}</p>}
      {form.reason && (
        <div role="alert" className="flex flex-col gap-1.5 rounded-md border border-danger-border bg-danger-soft p-2 text-xs text-danger">
          <span className="flex items-center gap-1.5">
            <TriangleAlert size={13} /> This command {form.reason}.
          </span>
          <label className="flex items-center gap-2 text-fg">
            <input type="checkbox" checked={form.confirmed} onChange={(e) => form.setConfirmed(e.target.checked)} className="accent-accent" />I checked it and want to run it
          </label>
        </div>
      )}
    </>
  );
}

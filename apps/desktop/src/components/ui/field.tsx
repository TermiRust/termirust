import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + error/hint. The control inside must carry the same aria-label. */
export function Field({ label, error, hint, className, children }: FieldProps) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-fg-muted ${className ?? ""}`}>
      <span>{label}</span>
      {children}
      {error ? <span className="text-accent">{error}</span> : hint ? <span>{hint}</span> : null}
    </label>
  );
}

export const selectClass =
  "h-8 w-full rounded-md border border-border bg-bg-elev px-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent";

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
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs font-medium text-fg-2">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
    </label>
  );
}

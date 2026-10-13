import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, className, ...props }: CheckboxProps) {
  return (
    <label className={cn("flex items-start gap-2 text-[13px] text-fg", className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-accent" {...props} />
      <span>
        {label}
        {description && <span className="mt-0.5 block text-xs text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}

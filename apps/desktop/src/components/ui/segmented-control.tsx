import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/** A radio group drawn as joined buttons; arrow keys move between enabled options. */
export function SegmentedControl<T extends string>({ label, value, options, onChange, className }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent, from: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    for (let i = 1; i <= options.length; i++) {
      const index = (from + step * i + options.length) % options.length;
      const option = options[index];
      if (option && !option.disabled) {
        onChange(option.value);
        refs.current[index]?.focus();
        return;
      }
    }
  };

  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-md border border-border-strong bg-bg-sunk p-0.5", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => move(e, index)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[5px] px-3 text-[13px] text-fg-muted transition-colors disabled:opacity-40",
              selected ? "bg-bg-elev text-fg shadow-panel" : "hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

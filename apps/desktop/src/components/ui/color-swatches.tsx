import { TAB_COLOR_CHOICES, tabColorVar, type TabColor } from "@/features/tabs/tab-color";
import { cn } from "@/lib/utils";

interface ColorSwatchesProps {
  label: string;
  value: TabColor | null;
  onChange: (color: TabColor | null) => void;
  /** Text for the "no override" choice. */
  autoLabel?: string;
}

export function ColorSwatches({ label, value, onChange, autoLabel = "Auto" }: ColorSwatchesProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        onClick={() => onChange(null)}
        className={cn("h-6 rounded-full border px-2 text-xs", value === null ? "border-accent text-fg" : "border-border text-fg-muted hover:text-fg")}
      >
        {autoLabel}
      </button>
      {TAB_COLOR_CHOICES.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={cn("h-6 w-6 rounded-full border-2", value === color ? "border-fg" : "border-transparent")}
          style={{ background: tabColorVar[color] }}
        />
      ))}
    </div>
  );
}

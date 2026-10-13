import { X } from "lucide-react";

import type { CustomTheme } from "@/bindings";
import { appThemeAttributes, appThemeChoices } from "@/lib/app-theme";
import { cn } from "@/lib/utils";

interface AppearancePickerProps {
  value: string;
  customThemes: CustomTheme[];
  onChange: (appTheme: string) => void;
  onRemove: (themeId: string) => void;
}

/** The mockup's light and dark Termirust tokens, for previews of the three modes. */
const MODE_PREVIEW = {
  light: { bg: "#fbfaf8", sunk: "#f2f0ec", fg: "#1d1b18", muted: "#9a948a", accent: "#c2410c", border: "#e3dfd8" },
  dark: { bg: "#15130f", sunk: "#100e0b", fg: "#ece8e1", muted: "#756f65", accent: "#fb923c", border: "#2f2b25" },
};

function previewColors(id: string, custom: CustomTheme[]) {
  if (id === "light" || id === "dark") return MODE_PREVIEW[id];
  const { vars } = appThemeAttributes(id, custom);
  return {
    bg: vars["--bg"] ?? MODE_PREVIEW.dark.bg,
    sunk: vars["--sunk"] ?? MODE_PREVIEW.dark.sunk,
    fg: vars["--fg"] ?? MODE_PREVIEW.dark.fg,
    muted: vars["--faint"] ?? MODE_PREVIEW.dark.muted,
    accent: vars["--accent"] ?? MODE_PREVIEW.dark.accent,
    border: vars["--border"] ?? MODE_PREVIEW.dark.border,
  };
}

function MiniWindow({ colors }: { colors: ReturnType<typeof previewColors> }) {
  return (
    <div className="flex h-12 overflow-hidden rounded border" style={{ background: colors.bg, borderColor: colors.border }}>
      <div className="flex w-1/3 flex-col gap-1 p-1.5" style={{ background: colors.sunk }}>
        <span className="h-1 w-3/4 rounded-full" style={{ background: colors.muted }} />
        <span className="h-1 w-1/2 rounded-full" style={{ background: colors.muted }} />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <span className="h-1 w-2/3 rounded-full" style={{ background: colors.fg }} />
        <span className="h-1 w-1/2 rounded-full" style={{ background: colors.muted }} />
        <span className="mt-auto h-2 w-6 rounded-sm" style={{ background: colors.accent }} />
      </div>
    </div>
  );
}

/** Appearance of the whole app: System / Light / Dark or any colour theme, imported ones included. */
export function AppearancePicker({ value, customThemes, onChange, onRemove }: AppearancePickerProps) {
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {appThemeChoices(customThemes).map((choice) => {
        const selected = choice.id === value;
        const imported = choice.id.startsWith("custom-");
        return (
          <div key={choice.id} className="relative">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={choice.name}
              onClick={() => onChange(choice.id)}
              className={cn("w-full rounded-lg border p-2 text-left transition-colors", selected ? "border-accent ring-2 ring-accent-ring" : "border-border hover:border-border-strong")}
            >
              {choice.id === "system" ? (
                <div className="grid grid-cols-2 gap-1">
                  <MiniWindow colors={MODE_PREVIEW.light} />
                  <MiniWindow colors={MODE_PREVIEW.dark} />
                </div>
              ) : (
                <MiniWindow colors={previewColors(choice.id, customThemes)} />
              )}
              <p className="mt-1.5 truncate pr-4 text-xs">{choice.name}</p>
            </button>
            {imported && (
              <button
                type="button"
                aria-label={`Remove ${choice.name}`}
                onClick={() => onRemove(choice.id)}
                className="absolute right-1.5 bottom-1.5 rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

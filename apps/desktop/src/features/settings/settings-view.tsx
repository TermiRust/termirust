import { FolderOpen, Minus, Plus, Settings as SettingsIcon } from "lucide-react";

import { commands } from "@/bindings";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { TERMINAL_THEMES, terminalTheme } from "@/lib/terminal-theme";
import { cn } from "@/lib/utils";
import { useSettingsStore, type ResolvedTerminalSettings } from "@/stores/settings-store";

import { FONT_CHOICES } from "./font-choices";


function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4 border-b border-border py-3 last:border-b-0">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function SettingsView() {
  const { terminal, error, updateTerminal } = useSettingsStore();
  const update = (patch: Partial<ResolvedTerminalSettings>) => void updateTerminal(patch);
  const fontLabel = FONT_CHOICES.find((f) => f.stack === terminal.fontFamily)?.label ?? "Custom";

  return (
    <section aria-label="Settings" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <SettingsIcon size={16} className="text-fg-muted" />
        <h1 className="text-[15px] font-semibold">Settings</h1>
        <span className="text-xs text-fg-muted">› Terminal</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 p-6 lg:grid-cols-[1fr_340px]">
          <div>
            {error && (
              <p role="alert" className="mb-3 text-[13px] text-danger">
                {error}
              </p>
            )}
            <Row label="Font">
              <div className="flex gap-2">
                <Select aria-label="Font family" value={fontLabel} onChange={(e) => {
                  const choice = FONT_CHOICES.find((f) => f.label === e.target.value);
                  if (choice) update({ fontFamily: choice.stack });
                }}>
                  {FONT_CHOICES.map((f) => (
                    <option key={f.label}>{f.label}</option>
                  ))}
                  {fontLabel === "Custom" && <option>Custom</option>}
                </Select>
                <div className="flex items-center rounded-md border border-border-strong bg-bg-elev">
                  <Button size="icon" aria-label="Smaller font" onClick={() => update({ fontSize: Math.max(8, terminal.fontSize - 1) })}>
                    <Minus size={13} />
                  </Button>
                  <span aria-label="Font size" className="w-8 text-center font-mono text-[13px] tabular-nums">
                    {terminal.fontSize}
                  </span>
                  <Button size="icon" aria-label="Larger font" onClick={() => update({ fontSize: Math.min(32, terminal.fontSize + 1) })}>
                    <Plus size={13} />
                  </Button>
                </div>
              </div>
            </Row>
            <Row label="Line height">
              <Select aria-label="Line height" value={String(terminal.lineHeight)} onChange={(e) => update({ lineHeight: Number(e.target.value) })}>
                {[1, 1.1, 1.2, 1.3, 1.4, 1.5].map((v) => (
                  <option key={v} value={String(v)}>
                    {v.toFixed(1)}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label="Theme">
              <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TERMINAL_THEMES.map((theme) => {
                  const c = theme.colors;
                  const selected = theme.id === terminal.theme;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={theme.name}
                      onClick={() => update({ theme: theme.id })}
                      className={cn("rounded-lg border p-2 text-left transition-colors", selected ? "border-accent ring-2 ring-accent-ring" : "border-border hover:border-border-strong")}
                    >
                      <div className="flex h-10 items-end gap-1 rounded p-1.5" style={{ background: c.background }}>
                        {[c.red, c.green, c.yellow, c.blue, c.magenta, c.cyan].map((color, i) => (
                          <span key={i} className="h-3 w-3 rounded-full" style={{ background: color }} />
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs">{theme.name}</p>
                    </button>
                  );
                })}
              </div>
            </Row>
            <Row label="Cursor">
              <div className="flex flex-wrap items-center gap-4">
                <SegmentedControl
                  label="Cursor style"
                  value={terminal.cursorStyle}
                  onChange={(cursorStyle) => update({ cursorStyle })}
                  options={[
                    { value: "block", label: "Block" },
                    { value: "bar", label: "Bar" },
                    { value: "underline", label: "Underline" },
                  ]}
                />
                <Checkbox label="Blink" checked={terminal.cursorBlink} onChange={(e) => update({ cursorBlink: e.target.checked })} />
              </div>
            </Row>
            <Row label="Scrollback" hint="Lines kept per tab (0–100 000)">
              <Field label="Scrollback lines" className="max-w-40 [&>span:first-child]:sr-only">
                <Input
                  aria-label="Scrollback lines"
                  inputMode="numeric"
                  defaultValue={terminal.scrollback}
                  key={terminal.scrollback}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value)) update({ scrollback: Math.max(0, Math.round(value)) });
                  }}
                />
              </Field>
            </Row>
            <Row label="Behaviour">
              <div className="flex flex-col gap-2.5">
                <Checkbox label="Copy on select" description="Selected text goes straight to the clipboard." checked={terminal.copyOnSelect} onChange={(e) => update({ copyOnSelect: e.target.checked })} />
                <Checkbox label="Confirm multi-line paste" description="Ask before pasting several commands at once." checked={terminal.confirmMultilinePaste} onChange={(e) => update({ confirmMultilinePaste: e.target.checked })} />
                <Checkbox label="Show status bar" checked={terminal.showStatusBar} onChange={(e) => update({ showStatusBar: e.target.checked })} />
              </div>
            </Row>
          </div>
          <TerminalPreview settings={terminal} />
          <div className="border-t border-border pt-4 lg:col-span-2">
            <Button variant="outline" size="sm" onClick={() => void commands.logsOpenFolder()}>
              <FolderOpen size={13} /> Open log folder
            </Button>
            <p className="mt-1 text-xs text-fg-muted">Logs never contain passwords, keys or terminal content.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function TerminalPreview({ settings }: { settings: ResolvedTerminalSettings }) {
  const c = terminalTheme(settings.theme).colors;
  const cursorClass = settings.cursorStyle === "block" ? "inline-block w-[0.6em]" : settings.cursorStyle === "bar" ? "inline-block w-[2px]" : "inline-block w-[0.6em] h-[2px] align-bottom";
  return (
    <figure aria-label="Preview" className="sticky top-6 self-start">
      <figcaption className="mb-2 text-xs font-semibold tracking-wider text-fg-muted uppercase">Preview</figcaption>
      <div
        className="overflow-hidden rounded-lg border border-border p-3 font-mono"
        style={{ background: c.background, color: c.foreground, fontFamily: settings.fontFamily, fontSize: settings.fontSize, lineHeight: settings.lineHeight }}
      >
        <div>
          <span style={{ color: c.green }}>deploy@prod-api-1</span>:<span style={{ color: c.blue }}>~/srv/api</span>$ git log --oneline -3
        </div>
        <div>
          <span style={{ color: c.yellow }}>a3f9c21</span> <span style={{ color: c.cyan }}>(HEAD → main)</span> fix(auth): rotate keys
        </div>
        <div>
          <span style={{ color: c.yellow }}>8b12e07</span> feat(api): cursor pagination
        </div>
        <div>
          <span style={{ color: c.red }}>error</span>: <span style={{ color: c.magenta }}>retrying</span> in 5s
        </div>
        <div>
          <span style={{ color: c.green }}>deploy@prod-api-1</span>:<span style={{ color: c.blue }}>~/srv/api</span>${" "}
          <span className={cursorClass} style={{ background: c.cursor, height: settings.cursorStyle === "underline" ? 2 : "1em", verticalAlign: settings.cursorStyle === "underline" ? "bottom" : "text-bottom" }} />
        </div>
      </div>
    </figure>
  );
}

import { CheckCircle2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { commands, type AiProviderKind, type AiSettingsInput, type AiSettingsView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAiStore } from "@/stores/ai-store";

import { AI_PRESETS, presetOf, type AiPreset } from "./ai-presets";


/** Loads the settings, then mounts the form once so its state starts from what is saved. */
export function AiSettingsSection() {
  const { settings, error, load } = useAiStore();
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="border-t border-border pt-4 lg:col-span-2">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        <Sparkles size={14} className="text-fg-muted" /> AI assistant
      </h2>
      <p className="mt-0.5 mb-3 text-xs text-fg-muted">
        Optional. Uses your own API key or a model running on this machine. Nothing is sent until you ask, and secrets are masked first.
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      {settings && <AiSettingsForm initial={settings} />}
    </div>
  );
}

function AiSettingsForm({ initial }: { initial: AiSettingsView }) {
  const save = useAiStore((s) => s.save);
  const saved = useAiStore((s) => s.settings) ?? initial;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [kind, setKind] = useState<AiProviderKind>(initial.kind);
  const [preset, setPreset] = useState<AiPreset>(() => presetOf(initial.kind, initial.baseUrl));
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error" | "busy"; text: string } | null>(null);

  const input = (): AiSettingsInput => ({
    enabled,
    kind,
    baseUrl,
    model,
    apiKey: apiKey ? { kind: "set", value: apiKey } : clearKey ? { kind: "clear" } : { kind: "keep" },
  });

  const changePreset = (id: string) => {
    const next = AI_PRESETS.find((p) => p.id === id);
    if (!next) return;
    // Swap the defaults along with the provider, but keep a model the user typed.
    setBaseUrl(next.id === "custom" ? "" : next.baseUrl);
    if (model === preset.model || !model) setModel(next.model);
    setKind(next.kind);
    setPreset(next);
  };

  const onSave = async () => {
    const result = await save(input());
    if (result.status === "error") {
      setStatus({ tone: "error", text: result.error.message });
      return;
    }
    // The key now lives in the vault; drop it from the page.
    setApiKey("");
    setClearKey(false);
    setStatus({ tone: "ok", text: "Saved" });
  };

  const onTest = async () => {
    setStatus({ tone: "busy", text: "Testing…" });
    const result = await commands.aiTestConnection(input());
    setStatus(result.status === "ok" ? { tone: "ok", text: `Connected — the model replied “${result.data}”` } : { tone: "error", text: result.error.message });
  };

  return (
    <form aria-label="AI assistant" className="grid max-w-2xl gap-3" onSubmit={(e) => (e.preventDefault(), void onSave())}>
      <Checkbox label="Turn on AI help" description="⌘I / Ctrl+I in a terminal, and “Ask AI” about selected output." checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      <Field label="Provider">
        <Select aria-label="AI provider" value={preset.id} onChange={(e) => changePreset(e.target.value)}>
          {AI_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Base URL" hint={preset.id === "custom" ? "The server's OpenAI-compatible base, ending before /chat/completions" : undefined}>
          <Input aria-label="Base URL" value={baseUrl} spellCheck={false} onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
        <Field label="Model">
          <Input aria-label="Model" value={model} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
        </Field>
      </div>
      <Field label="API key" hint={saved.hasApiKey ? "A key is saved in the vault. Type a new one to replace it." : preset.keyHint}>
        <Input
          aria-label="API key"
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={saved.hasApiKey && !clearKey ? "••••••••••••" : ""}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </Field>
      {saved.hasApiKey && <Checkbox label="Forget the saved key" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={() => void onTest()} disabled={status?.tone === "busy"}>
          Test connection
        </Button>
        {status && (
          <span role={status.tone === "error" ? "alert" : "status"} className={status.tone === "error" ? "text-xs text-danger" : "flex items-center gap-1 text-xs text-fg-muted"}>
            {status.tone === "ok" && <CheckCircle2 size={12} className="text-ok" />}
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}

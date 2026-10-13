import type { AiProviderKind } from "@/bindings";

export interface AiPreset {
  id: string;
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  keyHint: string;
}

/** Providers offered in Settings. All but Anthropic speak the OpenAI chat completions API. */
export const AI_PRESETS: AiPreset[] = [
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", keyHint: "From console.anthropic.com" },
  { id: "openai", label: "OpenAI", kind: "openAiCompatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyHint: "From platform.openai.com" },
  { id: "deepseek", label: "DeepSeek", kind: "openAiCompatible", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", keyHint: "From platform.deepseek.com" },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "openAiCompatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    keyHint: "From aistudio.google.com",
  },
  { id: "ollama", label: "Ollama (on this machine)", kind: "openAiCompatible", baseUrl: "http://localhost:11434/v1", model: "llama3.2", keyHint: "No key needed" },
  { id: "custom", label: "Other OpenAI-compatible", kind: "openAiCompatible", baseUrl: "", model: "", keyHint: "OpenRouter, LM Studio, a company gateway…" },
];

const normalize = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase();

/** Which preset saved settings correspond to; unknown URLs count as custom. */
export function presetOf(kind: AiProviderKind, baseUrl: string): AiPreset {
  const url = normalize(baseUrl);
  const custom = AI_PRESETS[AI_PRESETS.length - 1] as AiPreset;
  if (kind === "anthropic") return AI_PRESETS[0] as AiPreset;
  return AI_PRESETS.find((p) => p.kind === kind && p.id !== "custom" && normalize(p.baseUrl) === url) ?? custom;
}

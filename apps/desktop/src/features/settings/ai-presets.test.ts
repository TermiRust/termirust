import { describe, expect, it } from "vitest";

import { presetOf } from "./ai-presets";

describe("presetOf", () => {
  it("recognises presets from saved settings, ignoring trailing slashes and case", () => {
    expect(presetOf("anthropic", "https://api.anthropic.com").id).toBe("anthropic");
    expect(presetOf("openAiCompatible", "https://API.deepseek.com/").id).toBe("deepseek");
    expect(presetOf("openAiCompatible", "https://generativelanguage.googleapis.com/v1beta/openai").id).toBe("gemini");
    expect(presetOf("openAiCompatible", "http://localhost:11434/v1").id).toBe("ollama");
  });

  it("treats anything else as a custom OpenAI-compatible server", () => {
    expect(presetOf("openAiCompatible", "https://openrouter.ai/api/v1").id).toBe("custom");
    expect(presetOf("openAiCompatible", "").id).toBe("custom");
  });
});

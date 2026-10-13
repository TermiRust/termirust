import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiSettingsView } from "@/bindings";

const commands = { aiSettingsGet: vi.fn(), aiSettingsSet: vi.fn(), aiTestConnection: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { AiSettingsSection } = await import("./ai-settings-section");
const { useAiStore } = await import("@/stores/ai-store");

const ok = (data: unknown) => ({ status: "ok", data });
const off: AiSettingsView = { enabled: false, kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", hasApiKey: false };
const initial = useAiStore.getState();

async function renderForm(saved: AiSettingsView = off) {
  commands.aiSettingsGet.mockResolvedValue(ok(saved));
  render(<AiSettingsSection />);
  return within(await screen.findByRole("form", { name: "AI assistant" }));
}

describe("AiSettingsSection", () => {
  beforeEach(() => {
    useAiStore.setState(initial, true);
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.aiSettingsSet.mockImplementation(async (input: { enabled: boolean; kind: string; baseUrl: string; model: string; apiKey: { kind: string } }) =>
      ok({ enabled: input.enabled, kind: input.kind, baseUrl: input.baseUrl, model: input.model, hasApiKey: input.apiKey.kind !== "clear" }),
    );
  });

  it("starts off, and saves the provider with a new key", async () => {
    const user = userEvent.setup();
    const form = await renderForm();
    expect(form.getByRole("checkbox", { name: /Turn on AI help/ })).not.toBeChecked();

    await user.click(form.getByRole("checkbox", { name: /Turn on AI help/ }));
    await user.type(form.getByLabelText("API key"), "sk-ant-123");
    await user.click(form.getByRole("button", { name: "Save" }));

    expect(commands.aiSettingsSet).toHaveBeenCalledWith({
      enabled: true,
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-5-5",
      apiKey: { kind: "set", value: "sk-ant-123" },
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(useAiStore.getState().settings?.hasApiKey).toBe(true);
    expect(form.getByLabelText("API key")).toHaveValue("");
  });

  it("fills URL and model from the chosen provider, keeping a model the user typed", async () => {
    const user = userEvent.setup();
    const form = await renderForm();
    await user.selectOptions(form.getByRole("combobox", { name: "AI provider" }), "deepseek");
    expect(form.getByRole("textbox", { name: "Base URL" })).toHaveValue("https://api.deepseek.com");
    expect(form.getByRole("textbox", { name: "Model" })).toHaveValue("deepseek-chat");
    expect(form.getByText("From platform.deepseek.com")).toBeInTheDocument();

    await user.selectOptions(form.getByRole("combobox", { name: "AI provider" }), "gemini");
    expect(form.getByRole("textbox", { name: "Base URL" })).toHaveValue("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(form.getByRole("textbox", { name: "Model" })).toHaveValue("gemini-2.5-flash");

    await user.clear(form.getByRole("textbox", { name: "Model" }));
    await user.type(form.getByRole("textbox", { name: "Model" }), "gemini-2.5-pro");
    await user.selectOptions(form.getByRole("combobox", { name: "AI provider" }), "anthropic");
    expect(form.getByRole("textbox", { name: "Model" })).toHaveValue("gemini-2.5-pro");
    await user.click(form.getByRole("button", { name: "Save" }));
    expect(commands.aiSettingsSet).toHaveBeenCalledWith(expect.objectContaining({ kind: "anthropic", baseUrl: "https://api.anthropic.com" }));
  });

  it("opens on the preset that matches what is saved", async () => {
    const form = await renderForm({ ...off, kind: "openAiCompatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" });
    expect(form.getByRole("combobox", { name: "AI provider" })).toHaveValue("gemini");
  });

  it("keeps or forgets a saved key without ever showing it", async () => {
    const user = userEvent.setup();
    const form = await renderForm({ ...off, enabled: true, hasApiKey: true });
    expect(form.getByLabelText("API key")).toHaveValue("");
    expect(form.getByText(/A key is saved in the vault/)).toBeInTheDocument();

    await user.click(form.getByRole("button", { name: "Save" }));
    expect(commands.aiSettingsSet.mock.calls[0]?.[0]).toMatchObject({ apiKey: { kind: "keep" } });

    await user.click(form.getByRole("checkbox", { name: "Forget the saved key" }));
    await user.click(form.getByRole("button", { name: "Save" }));
    expect(commands.aiSettingsSet.mock.calls[1]?.[0]).toMatchObject({ apiKey: { kind: "clear" } });
    expect(await form.findByText("From console.anthropic.com")).toBeInTheDocument();
  });

  it("tests the connection with what is on screen and shows the result", async () => {
    commands.aiTestConnection.mockResolvedValueOnce(ok("OK")).mockResolvedValueOnce({ status: "error", error: { code: "ai", message: "AI: the provider rejected the API key (HTTP 401): invalid x-api-key" } });
    const user = userEvent.setup();
    const form = await renderForm();
    await user.type(form.getByLabelText("API key"), "sk-x");
    await user.click(form.getByRole("button", { name: "Test connection" }));
    expect(commands.aiTestConnection).toHaveBeenCalledWith(expect.objectContaining({ apiKey: { kind: "set", value: "sk-x" } }));
    expect(await form.findByRole("status")).toHaveTextContent("Connected — the model replied “OK”");

    await user.click(form.getByRole("button", { name: "Test connection" }));
    expect(await form.findByRole("alert")).toHaveTextContent("rejected the API key");
    expect(commands.aiSettingsSet).not.toHaveBeenCalled();
  });

  it("shows why settings could not be loaded", async () => {
    commands.aiSettingsGet.mockResolvedValue({ status: "error", error: { code: "keychain", message: "vault locked" } });
    render(<AiSettingsSection />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("vault locked"));
  });
});

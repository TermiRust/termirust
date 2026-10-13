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

  it("switches defaults with the provider but keeps a custom model", async () => {
    const user = userEvent.setup();
    const form = await renderForm();
    await user.click(form.getByRole("radio", { name: "OpenAI-compatible" }));
    expect(form.getByRole("textbox", { name: "Base URL" })).toHaveValue("https://api.openai.com/v1");
    expect(form.getByRole("textbox", { name: "Model" })).toHaveValue("gpt-4o-mini");

    await user.clear(form.getByRole("textbox", { name: "Model" }));
    await user.type(form.getByRole("textbox", { name: "Model" }), "llama3.2");
    await user.click(form.getByRole("radio", { name: "Anthropic" }));
    expect(form.getByRole("textbox", { name: "Model" })).toHaveValue("llama3.2");
    expect(form.getByRole("textbox", { name: "Base URL" })).toHaveValue("https://api.anthropic.com");
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

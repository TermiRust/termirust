import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiEvent } from "@/bindings";
import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const commands = { aiPreview: vi.fn(), aiAsk: vi.fn(), aiCancel: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { useTerminalAi } = await import("./use-terminal-ai");
const { useAiStore } = await import("@/stores/ai-store");

const ok = (data: unknown) => ({ status: "ok", data });
const emit = (event: AiEvent) => act(() => (FakeChannel.created.at(-1) as FakeChannel<AiEvent>).emit(event));
const preview = { provider: "DeepSeek · deepseek-chat", system: "You are the assistant…", user: "why?", masked: 0 };

function Harness({ onInsert = vi.fn() }: { onInsert?: (c: string) => void }) {
  const ai = useTerminalAi({
    allowed: true,
    target: "remote",
    hostId: "h1",
    insert: onInsert,
    focusTerminal: vi.fn(),
    readScreen: () => ({ text: "$ systemctl status nginx\nfailed", startLine: 120, endLine: 121 }),
  });
  return (
    <>
      <button type="button" onClick={() => ai.onAskAi?.({ text: "bind: address already in use", startLine: 35, endLine: 36 })}>
        quote
      </button>
      <button type="button" onClick={ai.openPanel}>
        open
      </button>
      {ai.panel}
    </>
  );
}

describe("AI panel", () => {
  beforeEach(() => {
    useAiStore.setState({ previewedThisSession: true, alwaysPreview: false });
    FakeChannel.created = [];
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.aiAsk.mockResolvedValue(ok(9));
    commands.aiPreview.mockResolvedValue(ok(preview));
    commands.aiCancel.mockResolvedValue(ok(true));
  });

  it("sends a quoted selection, streams a Markdown answer and inserts a suggested command", async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    render(<Harness onInsert={onInsert} />);
    await user.click(screen.getByRole("button", { name: "quote" }));
    const panel = within(screen.getByRole("complementary", { name: "AI assistant" }));
    await user.click(panel.getByRole("button", { name: "Quoted L35–L36" }));
    expect(panel.getByText("bind: address already in use")).toBeInTheDocument();

    await user.type(panel.getByRole("textbox", { name: "Ask the AI" }), "why?{Enter}");
    expect(commands.aiAsk).toHaveBeenCalledWith(
      { target: "remote", hostId: "h1", history: [], message: "why?", quotes: [{ label: "L35–L36", text: "bind: address already in use" }], screen: null },
      expect.anything(),
    );
    expect(panel.queryByRole("region", { name: "Attached" })).not.toBeInTheDocument();

    emit({ kind: "text", text: "## Port busy\n" });
    expect(panel.getByRole("heading", { name: "Port busy" })).toBeInTheDocument();
    emit({ kind: "done", reply: "## Port busy\n```sh\nsudo lsof -i :80\n```", commands: [{ command: "sudo lsof -i :80", danger: null }] });
    await user.click(panel.getByRole("button", { name: "Insert into terminal: sudo lsof -i :80" }));
    expect(onInsert).toHaveBeenCalledWith("sudo lsof -i :80");
  });

  it("attaches the terminal screen only when switched on, and keeps the conversation as history", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "open" }));
    const panel = within(screen.getByRole("complementary", { name: "AI assistant" }));
    await user.type(panel.getByRole("textbox", { name: "Ask the AI" }), "first{Enter}");
    emit({ kind: "done", reply: "answer one", commands: [] });

    await user.click(panel.getByRole("checkbox", { name: "Include terminal screen" }));
    await user.type(panel.getByRole("textbox", { name: "Ask the AI" }), "second{Enter}");
    const second = commands.aiAsk.mock.calls[1]?.[0];
    expect(second.history).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "answer one" },
    ]);
    expect(second.screen).toBe("$ systemctl status nginx\nfailed");
    expect(panel.getByRole("button", { name: "Quoted Screen L120–L121" })).toBeInTheDocument();
  });

  it("previews the first request of a session before sending", async () => {
    useAiStore.setState({ previewedThisSession: false });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "open" }));
    const panel = within(screen.getByRole("complementary", { name: "AI assistant" }));
    await user.type(panel.getByRole("textbox", { name: "Ask the AI" }), "why?{Enter}");
    expect(commands.aiAsk).not.toHaveBeenCalled();
    const sent = within(await panel.findByRole("region", { name: "What will be sent" }));
    await user.click(sent.getByRole("button", { name: "Send" }));
    expect(commands.aiAsk).toHaveBeenCalledOnce();
  });

  it("stops an answer, shows failures and starts a new conversation", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "open" }));
    const panel = within(screen.getByRole("complementary", { name: "AI assistant" }));
    await user.type(panel.getByRole("textbox", { name: "Ask the AI" }), "q{Enter}");
    await user.click(panel.getByRole("button", { name: "Stop" }));
    expect(commands.aiCancel).toHaveBeenCalledWith(9);
    emit({ kind: "failed", message: "AI: rate limited" });
    expect(panel.getByRole("alert")).toHaveTextContent("rate limited");

    await user.click(panel.getByRole("button", { name: "New conversation" }));
    expect(panel.queryByRole("alert")).not.toBeInTheDocument();
  });
});

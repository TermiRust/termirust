import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiEvent } from "@/bindings";
import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const commands = {
  aiPreview: vi.fn(),
  aiAsk: vi.fn(),
  aiCancel: vi.fn(),
  aiChatsList: vi.fn(),
  aiChatSave: vi.fn(),
  aiChatGet: vi.fn(),
  aiChatDelete: vi.fn(),
  commandDanger: vi.fn(async () => null),
};
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
    hostLabel: "prod-api",
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
    commands.aiChatsList.mockResolvedValue(ok([]));
    commands.aiChatSave.mockImplementation(async (input: { title: string; messages: unknown[] }) =>
      ok({ id: "c1", hostId: "h1", hostLabel: "prod-api", title: input.title, updatedAt: Date.now(), messageCount: input.messages.length }),
    );
    commands.aiChatDelete.mockResolvedValue(ok(null));
    commands.commandDanger.mockResolvedValue(null);
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

  describe("history", () => {
    const saved = {
      id: "c9",
      hostId: "h1",
      hostLabel: "prod-api",
      title: "why is nginx down?",
      messages: [
        { role: "user", text: "why is nginx down?", quotes: [{ label: "L3–L4", text: "failed" }] },
        { role: "assistant", text: "Restart it:\n```sh\nsudo systemctl restart nginx\n```", quotes: [] },
      ],
    };

    it("saves each finished answer to the server's history, then keeps updating the same chat", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(screen.getByRole("button", { name: "open" }));
      const panel = within(screen.getByRole("complementary", { name: "AI assistant" }));
      await user.type(panel.getByRole("textbox", { name: "Ask the AI" }), "disk full?{Enter}");
      emit({ kind: "done", reply: "Check `df -h`.", commands: [] });
      await vi.waitFor(() => expect(commands.aiChatSave).toHaveBeenCalledOnce());
      expect(commands.aiChatSave.mock.calls[0]?.[0]).toEqual({
        id: null,
        hostId: "h1",
        hostLabel: "prod-api",
        title: "disk full?",
        messages: [
          { role: "user", text: "disk full?", quotes: [] },
          { role: "assistant", text: "Check `df -h`.", quotes: [] },
        ],
      });

      await user.type(panel.getByRole("textbox", { name: "Ask the AI" }), "and inodes?{Enter}");
      emit({ kind: "done", reply: "`df -i`", commands: [] });
      await vi.waitFor(() => expect(commands.aiChatSave).toHaveBeenCalledTimes(2));
      expect(commands.aiChatSave.mock.calls[1]?.[0]).toMatchObject({ id: "c1" });

      await user.click(panel.getByRole("button", { name: "New conversation" }));
      await user.type(panel.getByRole("textbox", { name: "Ask the AI" }), "fresh{Enter}");
      emit({ kind: "done", reply: "ok", commands: [] });
      await vi.waitFor(() => expect(commands.aiChatSave).toHaveBeenCalledTimes(3));
      expect(commands.aiChatSave.mock.calls[2]?.[0]).toMatchObject({ id: null, title: "fresh" });
    });

    it("reopens the server's latest conversation, with Insert buttons, when the panel first opens", async () => {
      commands.aiChatsList.mockResolvedValue(ok([{ id: "c9", hostId: "h1", hostLabel: "prod-api", title: saved.title, updatedAt: Date.now(), messageCount: 2 }]));
      commands.aiChatGet.mockResolvedValue(ok(saved));
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(screen.getByRole("button", { name: "open" }));
      const panel = within(screen.getByRole("complementary", { name: "AI assistant" }));
      expect(await panel.findByText("why is nginx down?")).toBeInTheDocument();
      expect(panel.getByRole("button", { name: "Quoted L3–L4" })).toBeInTheDocument();
      expect(await panel.findByRole("button", { name: "Insert into terminal: sudo systemctl restart nginx" })).toBeInTheDocument();
      expect(commands.aiChatsList).toHaveBeenCalledWith("h1", false);
    });

    it("lists past conversations, opens one and deletes another after confirmation", async () => {
      commands.aiChatsList.mockResolvedValue(
        ok([
          { id: "c9", hostId: "h1", hostLabel: "prod-api", title: saved.title, updatedAt: Date.now() - 3_600_000, messageCount: 2 },
          { id: "c8", hostId: "h1", hostLabel: "prod-api", title: "old question", updatedAt: Date.now() - 86_400_000, messageCount: 4 },
        ]),
      );
      commands.aiChatGet.mockResolvedValue(ok(saved));
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(screen.getByRole("button", { name: "open" }));
      const panel = within(screen.getByRole("complementary", { name: "AI assistant" }));
      await panel.findByText("why is nginx down?");

      await user.click(panel.getByRole("button", { name: "History" }));
      const list = within(panel.getByRole("region", { name: "Past conversations" }));
      expect(list.getByText("old question")).toBeInTheDocument();
      expect(list.getByText(/4 messages/)).toBeInTheDocument();

      await user.click(list.getByRole("button", { name: "Delete old question" }));
      expect(commands.aiChatDelete).not.toHaveBeenCalled();
      await user.click(list.getByRole("button", { name: "Confirm delete old question" }));
      expect(commands.aiChatDelete).toHaveBeenCalledWith("c8");

      await user.click(list.getByRole("button", { name: `Open conversation: ${saved.title}` }));
      expect(panel.queryByRole("region", { name: "Past conversations" })).not.toBeInTheDocument();
      expect(commands.aiChatGet).toHaveBeenLastCalledWith("c9");
    });
  });
});

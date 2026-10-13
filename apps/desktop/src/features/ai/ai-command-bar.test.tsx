import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiEvent } from "@/bindings";
import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
const commands = { aiPreview: vi.fn(), aiAsk: vi.fn(), aiCancel: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { AiCommandBar } = await import("./ai-command-bar");
const { useAiStore } = await import("@/stores/ai-store");

const ok = (data: unknown) => ({ status: "ok", data });
const preview = {
  provider: "Anthropic · claude-sonnet-5-5 · https://api.anthropic.com",
  system: "You turn a request into one shell command…",
  user: "connect with password=[REDACTED:secret]",
  masked: 1,
};
const emit = (event: AiEvent) => act(() => (FakeChannel.created.at(-1) as FakeChannel<AiEvent>).emit(event));
const done = (command: string | null, danger: string | null = null, reply = command ?? ""): AiEvent => ({ kind: "done", reply, command, danger, commands: [] });
const initialAi = useAiStore.getState();

function setup() {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(<AiCommandBar target="remote" hostId="h1" onInsert={onInsert} onClose={onClose} />);
  return { onInsert, onClose, user: userEvent.setup(), bar: within(screen.getByRole("dialog", { name: "Ask AI for a command" })) };
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole("textbox", { name: "Describe the command you need" }), `${text}{Enter}`);
}

describe("AiCommandBar", () => {
  beforeEach(() => {
    useAiStore.setState({ ...initialAi, previewedThisSession: false, alwaysPreview: false }, true);
    localStorage.clear();
    FakeChannel.created = [];
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.aiPreview.mockResolvedValue(ok(preview));
    commands.aiAsk.mockResolvedValue(ok(7));
    commands.aiCancel.mockResolvedValue(ok(true));
  });

  it("previews the first request, streams the answer and inserts the command without running it", async () => {
    const { user, bar, onInsert, onClose } = setup();
    await ask(user, "connect with password=hunter2");

    expect(commands.aiPreview).toHaveBeenCalledWith({ target: "remote", hostId: "h1", question: { mode: "command", prompt: "connect with password=hunter2" } });
    const sent = within(await bar.findByRole("region", { name: "What will be sent" }));
    expect(sent.getByText(/1 secret was masked/)).toBeInTheDocument();
    expect(sent.getByLabelText("Your text as sent")).toHaveTextContent("password=[REDACTED:secret]");
    expect(commands.aiAsk).not.toHaveBeenCalled();

    await user.click(sent.getByRole("button", { name: "Send" }));
    expect(commands.aiAsk).toHaveBeenCalledTimes(1);
    emit({ kind: "text", text: "psql " });
    emit({ kind: "text", text: "-l" });
    expect(bar.getByLabelText("Answer so far")).toHaveTextContent("psql -l");
    emit(done("psql -l"));

    expect(bar.getByLabelText("Suggested command")).toHaveTextContent("psql -l");
    await user.click(bar.getByRole("button", { name: "Insert" }));
    expect(onInsert).toHaveBeenCalledWith("psql -l");
    expect(onClose).toHaveBeenCalled();
  });

  it("skips the preview after the first send of the session unless asked to always show it", async () => {
    useAiStore.setState({ previewedThisSession: true });
    const { user } = setup();
    await ask(user, "disk usage");
    expect(commands.aiPreview).not.toHaveBeenCalled();
    expect(commands.aiAsk).toHaveBeenCalledTimes(1);

    act(() => useAiStore.getState().setAlwaysPreview(true));
    expect(localStorage.getItem("termirust.ai.alwaysPreview")).toBe("1");
    emit(done("du -sh ."));
    await ask(user, " again");
    expect(commands.aiPreview).toHaveBeenCalledTimes(1);
  });

  it("warns about dangerous commands", async () => {
    useAiStore.setState({ previewedThisSession: true });
    const { user, bar } = setup();
    await ask(user, "clean everything");
    emit(done("rm -rf ./build", "deletes files recursively without asking"));
    expect(bar.getByRole("alert")).toHaveTextContent("Careful: this deletes files recursively without asking");
    expect(bar.getByRole("button", { name: "Insert" }).className).toMatch(/danger/);
  });

  it("shows the model's reason when it declines", async () => {
    useAiStore.setState({ previewedThisSession: true });
    const { user, bar } = setup();
    await ask(user, "wipe the server");
    emit(done(null, null, "# That would destroy data on the server."));
    expect(bar.getByText("That would destroy data on the server.")).toBeInTheDocument();
    expect(bar.queryByRole("button", { name: "Insert" })).not.toBeInTheDocument();
  });

  it("stops a streaming answer and reports failures", async () => {
    useAiStore.setState({ previewedThisSession: true });
    const { user, bar } = setup();
    await ask(user, "list ports");
    await user.click(bar.getByRole("button", { name: "Stop" }));
    expect(commands.aiCancel).toHaveBeenCalledWith(7);
    emit({ kind: "cancelled" });
    expect(bar.getByText("Stopped.")).toBeInTheDocument();

    commands.aiAsk.mockResolvedValue({ status: "error", error: { code: "ai", message: "AI: AI is turned off for this host" } });
    await ask(user, "!");
    expect(await bar.findByRole("alert")).toHaveTextContent("turned off for this host");
  });

  it("closes with Escape and cancels what is still running", async () => {
    useAiStore.setState({ previewedThisSession: true });
    const { user, onClose } = setup();
    await ask(user, "uptime");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Describe the command you need" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(commands.aiCancel).toHaveBeenCalledWith(7);
  });
});

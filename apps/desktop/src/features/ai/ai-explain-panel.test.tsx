import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiEvent } from "@/bindings";
import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));
const commands = { aiPreview: vi.fn(), aiAsk: vi.fn(), aiCancel: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { AiExplainPanel } = await import("./ai-explain-panel");
const { useAiStore } = await import("@/stores/ai-store");

const ok = (data: unknown) => ({ status: "ok", data });
const emit = (event: AiEvent) => act(() => (FakeChannel.created.at(-1) as FakeChannel<AiEvent>).emit(event));
const selection = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");

function setup() {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(<AiExplainPanel target="remote" hostId="h1" selection={selection} onInsert={onInsert} onClose={onClose} />);
  return { onInsert, onClose, user: userEvent.setup(), panel: within(screen.getByRole("complementary", { name: "Ask AI about the selection" })) };
}

describe("AiExplainPanel", () => {
  beforeEach(() => {
    useAiStore.setState({ previewedThisSession: true, alwaysPreview: false });
    FakeChannel.created = [];
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.aiAsk.mockResolvedValue(ok(3));
    commands.aiCancel.mockResolvedValue(ok(true));
  });

  it("quotes the start of the selection and asks with an optional question", async () => {
    const { user, panel } = setup();
    expect(panel.getByLabelText("Selected output")).toHaveTextContent("line 8");
    expect(panel.getByLabelText("Selected output")).toHaveTextContent("… 4 more lines");
    expect(panel.getByLabelText("Selected output")).not.toHaveTextContent("line 9");

    await user.type(panel.getByRole("textbox", { name: "Question about the selection" }), "why?{Enter}");
    expect(commands.aiAsk).toHaveBeenCalledWith({ target: "remote", hostId: "h1", question: { mode: "explain", selection, question: "why?" } }, expect.anything());
  });

  it("streams the answer and inserts a suggested command, flagging risky ones", async () => {
    const { user, panel, onInsert, onClose } = setup();
    await user.click(panel.getByRole("button", { name: "Ask" }));
    emit({ kind: "text", text: "The disk is full.\n```sh\ndu -sh /var/log" });
    expect(panel.getByLabelText("Answer")).toHaveTextContent("The disk is full.");
    expect(panel.queryByRole("button", { name: /Insert into terminal/ })).not.toBeInTheDocument();

    emit({
      kind: "done",
      reply: "The disk is full.\n```sh\ndu -sh /var/log\n```\nOr:\n```sh\nrm -rf /var/log/old\n```",
      command: null,
      danger: null,
      commands: [
        { command: "du -sh /var/log", danger: null },
        { command: "rm -rf /var/log/old", danger: "deletes files recursively without asking" },
      ],
    });
    expect(panel.getByRole("alert")).toHaveTextContent("This deletes files recursively without asking.");
    await user.click(panel.getByRole("button", { name: "Insert into terminal: du -sh /var/log" }));
    expect(onInsert).toHaveBeenCalledWith("du -sh /var/log");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes with Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Question about the selection" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

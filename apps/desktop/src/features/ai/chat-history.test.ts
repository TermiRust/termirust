import { describe, expect, it, vi } from "vitest";

const commands = { commandDanger: vi.fn(async (c: string) => (c.includes("rm -rf") ? "deletes files recursively without asking" : null)) };
vi.mock("@/bindings", () => ({ commands }));

const { chatTitle, relativeTime, suggestionsFor, toSavedMessages } = await import("./chat-history");

const entry = (role: "user" | "assistant", text: string, extra: object = {}) => ({ id: 1, role, text, quotes: [], withScreen: false, status: "done" as const, commands: [], ...extra });

describe("chat history helpers", () => {
  it("titles a chat by its first question, or by what was quoted", () => {
    expect(chatTitle([entry("user", "  why is   nginx down? ")])).toBe("why is nginx down?");
    expect(chatTitle([entry("user", "", { quotes: [{ label: "L35–L55", text: "x" }] })])).toBe("Explain L35–L55");
    expect(chatTitle([entry("user", "x".repeat(100))])).toHaveLength(58);
    expect(chatTitle([])).toBe("Untitled chat");
  });

  it("saves questions and finished answers only", () => {
    const saved = toSavedMessages([
      entry("user", "q", { quotes: [{ label: "L1", text: "err" }] }),
      entry("assistant", "", { status: "failed" }),
      entry("assistant", "answer"),
      entry("assistant", "half", { status: "streaming" }),
    ]);
    expect(saved).toEqual([
      { role: "user", text: "q", quotes: [{ label: "L1", text: "err" }] },
      { role: "assistant", text: "answer", quotes: [] },
    ]);
  });

  it("rebuilds insertable commands with danger notes for a saved answer", async () => {
    const reply = "Try:\n```sh\nls -la\n```\nor\n```bash\nrm -rf ./tmp\n```\n```json\n{}\n```";
    expect(await suggestionsFor(reply)).toEqual([
      { command: "ls -la", danger: null },
      { command: "rm -rf ./tmp", danger: "deletes files recursively without asking" },
    ]);
  });

  it("describes how long ago a chat was updated", () => {
    const now = Date.UTC(2026, 9, 14, 12);
    expect(relativeTime(now - 30_000, now)).toMatch(/minute|now/);
    expect(relativeTime(now - 5 * 60_000, now)).toMatch(/5/);
    expect(relativeTime(now - 2 * 86_400_000, now)).toMatch(/2|ago/);
  });
});

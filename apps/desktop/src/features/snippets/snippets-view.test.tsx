import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SnippetView } from "@/bindings";

const commands = { snippetsList: vi.fn(), snippetsCreate: vi.fn(), snippetsUpdate: vi.fn(), snippetsDelete: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { SnippetsView } = await import("./snippets-view");
const { matchesSnippet, useSnippetsStore } = await import("@/stores/snippets-store");

const ok = (data: unknown) => ({ status: "ok", data });
const logs: SnippetView = { id: "s1", name: "Follow logs", command: "journalctl -u {{service:nginx}} -f", description: "systemd", tags: ["logs"] };
const disk: SnippetView = { id: "s2", name: "Disk", command: "df -h", description: "", tags: [] };
const initial = useSnippetsStore.getState();

describe("SnippetsView", () => {
  beforeEach(() => {
    useSnippetsStore.setState(initial, true);
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.snippetsList.mockResolvedValue(ok([disk, logs]));
  });

  it("explains the empty state", async () => {
    commands.snippetsList.mockResolvedValue(ok([]));
    render(<SnippetsView />);
    expect(await screen.findByText("No snippets yet")).toBeInTheDocument();
  });

  it("lists snippets with their variables and filters by any field", async () => {
    const user = userEvent.setup();
    render(<SnippetsView />);
    const item = await screen.findByRole("listitem", { name: "Follow logs" });
    expect(item).toHaveTextContent("systemd · asks for service");

    await user.type(screen.getByRole("searchbox", { name: "Search snippets" }), "journal logs");
    expect(screen.queryByRole("listitem", { name: "Disk" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search snippets" }));
    await user.type(screen.getByRole("searchbox", { name: "Search snippets" }), "zzz");
    expect(screen.getByText("No snippet matches “zzz”.")).toBeInTheDocument();
  });

  it("creates a snippet, showing variables while typing", async () => {
    commands.snippetsList.mockResolvedValue(ok([]));
    commands.snippetsCreate.mockImplementation(async (input: Omit<SnippetView, "id">) => ok({ ...input, id: "s3", name: input.name || "tail" }));
    const user = userEvent.setup();
    render(<SnippetsView />);
    await user.click(await screen.findByRole("button", { name: "New snippet" }));
    const dialog = within(await screen.findByRole("dialog", { name: "New snippet" }));

    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(dialog.getByRole("alert")).toHaveTextContent("Enter the command to save");

    await user.type(dialog.getByRole("textbox", { name: "Command" }), "tail -n {{{{lines:50}} {{{{file}}");
    expect(dialog.getByLabelText("Variables")).toHaveTextContent("lines = 50");
    expect(dialog.getByLabelText("Variables")).toHaveTextContent("file");
    await user.type(dialog.getByRole("textbox", { name: "Tags" }), "logs, ops");
    await user.click(dialog.getByRole("button", { name: "Save" }));

    expect(commands.snippetsCreate).toHaveBeenCalledWith({ name: "", command: "tail -n {{lines:50}} {{file}}", description: "", tags: ["logs", "ops"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("listitem", { name: "tail" })).toBeInTheDocument();
  });

  it("edits and deletes", async () => {
    commands.snippetsUpdate.mockResolvedValue(ok({ ...disk, command: "df -h /" }));
    commands.snippetsDelete.mockResolvedValue(ok(null));
    const user = userEvent.setup();
    render(<SnippetsView />);
    await user.click(await screen.findByRole("button", { name: "Edit Disk" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Edit Disk" }));
    await user.type(dialog.getByRole("textbox", { name: "Command" }), " /");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    expect(commands.snippetsUpdate).toHaveBeenCalledWith("s2", expect.objectContaining({ command: "df -h /" }));

    await user.click(screen.getByRole("button", { name: "Delete Disk" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete Disk?" })).getByRole("button", { name: "Delete" }));
    expect(commands.snippetsDelete).toHaveBeenCalledWith("s2");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Disk" })).not.toBeInTheDocument());
  });

  it("offers Use only when a terminal can take the snippet", async () => {
    const onUse = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<SnippetsView />);
    await screen.findByRole("listitem", { name: "Disk" });
    expect(screen.queryByRole("button", { name: "Use Disk" })).not.toBeInTheDocument();
    unmount();
    render(<SnippetsView onUse={onUse} />);
    await user.click(await screen.findByRole("button", { name: "Use Disk" }));
    expect(onUse).toHaveBeenCalledWith(disk);
  });
});

describe("matchesSnippet", () => {
  it("needs every word somewhere in the snippet", () => {
    expect(matchesSnippet(logs, "NGINX journal")).toBe(true);
    expect(matchesSnippet(logs, "logs disk")).toBe(false);
    expect(matchesSnippet(logs, "  ")).toBe(true);
  });
});

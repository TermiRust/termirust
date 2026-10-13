import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SnippetView } from "@/bindings";

const commands = { commandDanger: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { SnippetRunDialog } = await import("./snippet-run-dialog");

const snippet = (command: string): SnippetView => ({ id: "s", name: "Tail", command, description: "", tags: [] });

function setup(command: string) {
  const onSend = vi.fn();
  const onClose = vi.fn();
  render(<SnippetRunDialog snippet={snippet(command)} targetLabel="prod-api" onSend={onSend} onClose={onClose} />);
  return { onSend, onClose, user: userEvent.setup(), dialog: within(screen.getByRole("dialog", { name: "Run Tail" })) };
}

describe("SnippetRunDialog", () => {
  beforeEach(() => {
    commands.commandDanger.mockReset();
    commands.commandDanger.mockImplementation(async (command: string) => (command.includes("rm -rf") ? "deletes files recursively without asking" : null));
  });

  it("fills variables, shows the final command and inserts it without Enter", async () => {
    const { user, dialog, onSend, onClose } = setup("tail -n {{lines:50}} {{file}}");
    expect(dialog.getByText("In prod-api")).toBeInTheDocument();
    expect(dialog.getByRole("textbox", { name: "lines" })).toHaveValue("50");
    expect(dialog.getByText("Still empty: file")).toBeInTheDocument();

    await user.type(dialog.getByRole("textbox", { name: "file" }), "/var/log/syslog");
    expect(dialog.getByLabelText("Command to send")).toHaveTextContent("tail -n 50 /var/log/syslog");
    await user.click(dialog.getByRole("button", { name: "Insert" }));
    expect(onSend).toHaveBeenCalledWith("tail -n 50 /var/log/syslog");
    expect(onClose).toHaveBeenCalled();
  });

  it("runs with Enter after each line and offers no Insert for multi-line snippets", async () => {
    const { user, dialog, onSend } = setup("cd /srv/app\ngit pull");
    expect(dialog.queryByRole("button", { name: "Insert" })).not.toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Run" }));
    expect(onSend).toHaveBeenCalledWith("cd /srv/app\rgit pull\r");
  });

  it("makes the user confirm a dangerous command before running", async () => {
    const { user, dialog, onSend } = setup("rm -rf {{dir:./build}}");
    expect(await dialog.findByRole("alert")).toHaveTextContent("This command deletes files recursively without asking.");
    expect(dialog.getByRole("button", { name: "Run" })).toBeDisabled();

    await user.click(dialog.getByRole("checkbox", { name: /I checked it/ }));
    await user.click(dialog.getByRole("button", { name: "Run" }));
    expect(onSend).toHaveBeenCalledWith("rm -rf ./build\r");
  });

  it("asks again after the command changes", async () => {
    const { user, dialog } = setup("rm -rf {{dir:./build}}");
    await dialog.findByRole("alert");
    await user.click(dialog.getByRole("checkbox", { name: /I checked it/ }));
    await user.type(dialog.getByRole("textbox", { name: "dir" }), "x");
    expect(await dialog.findByRole("checkbox", { name: /I checked it/ })).not.toBeChecked();
  });
});

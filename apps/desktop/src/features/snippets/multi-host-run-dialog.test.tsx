import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupView, HostView, SnippetView } from "@/bindings";

const commands = { commandDanger: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { MultiHostRunDialog } = await import("./multi-host-run-dialog");
const { useHostsStore } = await import("@/stores/hosts-store");

const host = (id: string, groupId: string | null = null): HostView => ({
  id,
  label: id,
  hostname: `${id}.internal`,
  port: 22,
  username: null,
  auth: { method: "agent" },
  groupId,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null,
  color: null,
  aiDisabled: false,
});
const web: GroupView = { id: "g1", name: "Web", parentId: null, color: null, warningBorder: false, aiDisabled: false };
const snippet = (command: string): SnippetView => ({ id: "s", name: "Restart", command, description: "", tags: [] });

function setup(command: string) {
  const onRun = vi.fn();
  const onClose = vi.fn();
  render(<MultiHostRunDialog snippet={snippet(command)} onRun={onRun} onClose={onClose} />);
  return { onRun, onClose, user: userEvent.setup(), dialog: within(screen.getByRole("dialog", { name: "Run Restart on several hosts" })) };
}

describe("MultiHostRunDialog", () => {
  beforeEach(() => {
    useHostsStore.setState({ hosts: [host("web-1", "g1"), host("web-2", "g1"), host("db")], groups: [web], loaded: true, error: null });
    commands.commandDanger.mockReset();
    commands.commandDanger.mockImplementation(async (command: string) => (command.includes("reboot") ? "stops or restarts the machine" : null));
  });

  it("selects a whole group, reviews the host list, then runs everywhere", async () => {
    const { user, dialog, onRun, onClose } = setup("sudo systemctl restart {{service:nginx}}");
    expect(dialog.getByRole("button", { name: /Review/ })).toBeDisabled();

    await user.click(dialog.getByRole("checkbox", { name: "All hosts in Web" }));
    await user.click(dialog.getByRole("button", { name: "Review 2 hosts" }));
    const list = dialog.getByRole("list", { name: "Hosts that will run it" });
    expect(list).toHaveTextContent("web-1");
    expect(list).toHaveTextContent("web-2");
    expect(list).not.toHaveTextContent("db");

    await user.click(dialog.getByRole("button", { name: "Run on 2 hosts" }));
    expect(onRun).toHaveBeenCalledWith([expect.objectContaining({ id: "web-1" }), expect.objectContaining({ id: "web-2" })], "sudo systemctl restart nginx\r");
    expect(onClose).toHaveBeenCalled();
  });

  it("can go back from the review and needs confirmation for dangerous commands", async () => {
    const { user, dialog } = setup("sudo reboot");
    await user.click(dialog.getByRole("checkbox", { name: "db" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("stops or restarts the machine");
    expect(dialog.getByRole("button", { name: "Review 1 host" })).toBeDisabled();

    await user.click(dialog.getByRole("checkbox", { name: /I checked it/ }));
    await user.click(dialog.getByRole("button", { name: "Review 1 host" }));
    await user.click(dialog.getByRole("button", { name: "Back" }));
    expect(dialog.getByRole("checkbox", { name: "db" })).toBeChecked();
  });
});

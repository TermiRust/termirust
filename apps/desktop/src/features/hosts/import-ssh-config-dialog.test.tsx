import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SshConfigCandidate } from "@/bindings";

const commands = {
  sshConfigPreview: vi.fn(),
  sshConfigImport: vi.fn(),
  hostsList: vi.fn(),
  groupsList: vi.fn(),
  keysList: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));

const { ImportSshConfigDialog } = await import("./import-ssh-config-dialog");

const candidate = (alias: string, overrides: Partial<SshConfigCandidate> = {}): SshConfigCandidate => ({
  alias,
  hostname: `${alias}.example.com`,
  port: 22,
  user: "deploy",
  identityFiles: [],
  proxyJump: null,
  proxyCommand: null,
  alreadySaved: false,
  adds: [],
  ...overrides,
});
const ok = <T,>(data: T) => ({ status: "ok", data });

function renderWith(candidates: SshConfigCandidate[], unsupported: string[] = []) {
  commands.sshConfigPreview.mockResolvedValue(ok({ path: "/Users/me/.ssh/config", candidates, unsupported }));
  const onOpenChange = vi.fn();
  render(<ImportSshConfigDialog open onOpenChange={onOpenChange} />);
  return { onOpenChange, user: userEvent.setup() };
}

describe("ImportSshConfigDialog", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
    commands.hostsList.mockResolvedValue(ok([]));
    commands.groupsList.mockResolvedValue(ok([]));
    commands.keysList.mockResolvedValue(ok([]));
  });

  it("previews hosts, preselecting only those not saved yet", async () => {
    renderWith([
      candidate("prod", { port: 2222, identityFiles: ["/Users/me/.ssh/prod_ed25519"], proxyJump: "bastion" }),
      candidate("old", { alreadySaved: true }),
      candidate("debian", { proxyCommand: "cloudflared access ssh --hostname %h" }),
    ]);
    const list = await screen.findByRole("list", { name: "Hosts in config" });
    expect(within(list).getByTitle("cloudflared access ssh --hostname %h")).toHaveTextContent("cloudflared");
    expect(within(list).getByRole("checkbox", { name: "prod" })).toBeChecked();
    expect(within(list).getByRole("checkbox", { name: "old" })).not.toBeChecked();
    expect(list).toHaveTextContent("deploy@prod.example.com:2222");
    expect(list).toHaveTextContent("prod_ed25519");
    expect(list).toHaveTextContent("via bastion");
    expect(list).toHaveTextContent("already saved");
    expect(screen.getByRole("button", { name: "Import 2 hosts" })).toBeEnabled();
  });

  it("offers to complete a saved host the config has more settings for, and reports it as updated", async () => {
    commands.sshConfigImport.mockResolvedValue(ok({ createdHosts: [], updatedHosts: ["debian"], importedKeys: [], skipped: [] }));
    const { user } = renderWith([
      candidate("debian", { alreadySaved: true, adds: ["proxy command"], proxyCommand: "cloudflared access ssh --hostname %h" }),
      candidate("old", { alreadySaved: true }),
    ]);
    const list = await screen.findByRole("list", { name: "Hosts in config" });
    expect(within(list).getByRole("checkbox", { name: "debian" })).toBeChecked();
    expect(within(list).getByRole("checkbox", { name: "old" })).not.toBeChecked();
    expect(list).toHaveTextContent("already saved · adds proxy command");
    await user.click(screen.getByRole("button", { name: "Import 1 host" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Updated 1 host (debian).");
  });

  it("warns about settings it does not apply", async () => {
    renderWith([candidate("a")], ["LocalForward", "Match"]);
    expect(await screen.findByText(/Not applied yet: LocalForward, Match/)).toBeInTheDocument();
  });

  it("imports the selected hosts in file order and reports the outcome", async () => {
    commands.sshConfigImport.mockResolvedValue(
      ok({ createdHosts: ["a", "c"], updatedHosts: [], importedKeys: ["id_ed25519"], skipped: [{ alias: "b", reason: "already saved" }] }),
    );
    const { user } = renderWith([candidate("a"), candidate("b"), candidate("c")]);
    await user.click(await screen.findByRole("checkbox", { name: "b" }));
    await user.click(screen.getByRole("checkbox", { name: "b" }));
    await user.click(screen.getByRole("button", { name: "Import 3 hosts" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Imported 2 hosts and 1 key.");
    expect(screen.getByRole("list", { name: "Skipped hosts" })).toHaveTextContent("b: already saved");
    expect(commands.sshConfigImport).toHaveBeenCalledWith("/Users/me/.ssh/config", ["a", "b", "c"]);
    await waitFor(() => expect(commands.hostsList).toHaveBeenCalled());
    expect(commands.keysList).toHaveBeenCalled();
  });

  it("disables import when nothing is selected", async () => {
    const { user } = renderWith([candidate("only")]);
    await user.click(await screen.findByRole("checkbox", { name: "only" }));
    expect(screen.getByRole("button", { name: "Import 0 hosts" })).toBeDisabled();
  });

  it("shows why the config could not be read", async () => {
    commands.sshConfigPreview.mockResolvedValue({ status: "error", error: { code: "invalid_data", message: "cannot read /Users/me/.ssh/config" } });
    render(<ImportSshConfigDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot read");
  });

  it("explains an empty config", async () => {
    renderWith([]);
    expect(await screen.findByText(/No concrete hosts found/)).toBeInTheDocument();
  });
});

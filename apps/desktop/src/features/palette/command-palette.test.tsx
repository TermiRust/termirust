import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { HostView } from "@/bindings";

import { CommandPalette, type PaletteCommand } from "./command-palette";

const host = (id: string, label: string, overrides: Partial<HostView> = {}): HostView => ({
  id,
  label,
  hostname: `${label}.example.com`,
  port: 22,
  username: "deploy",
  auth: { method: "agent" },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null, aiDisabled: false, os: null, environment: null, proxyCommand: null,
  color: null,
  ...overrides,
});
const hosts = [host("1", "prod-api"), host("2", "prod-db", { port: 2222 }), host("3", "staging-web", { tags: ["frontend"] })];

function setup(recentHostIds: string[] = []) {
  const onOpenHost = vi.fn();
  const onOpenSftp = vi.fn();
  const onOpenChange = vi.fn();
  const newHost = vi.fn();
  const commands: PaletteCommand[] = [
    { id: "new-host", label: "New host", icon: null, shortcut: "⌘N", run: newHost },
    { id: "keychain", label: "Open Keychain", icon: null, run: vi.fn() },
  ];
  render(<CommandPalette open onOpenChange={onOpenChange} hosts={hosts} recentHostIds={recentHostIds} commands={commands} onOpenHost={onOpenHost} onOpenSftp={onOpenSftp} />);
  return { onOpenHost, onOpenSftp, onOpenChange, newHost, user: userEvent.setup() };
}

const options = () => within(screen.getByRole("listbox", { name: "Results" })).queryAllByRole("option");

describe("CommandPalette", () => {
  it("shows recent connections and commands before typing", () => {
    setup(["2", "gone"]);
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining("prod-db"),
      expect.stringContaining("New host"),
      expect.stringContaining("Open Keychain"),
    ]);
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("fuzzy-filters hosts with highlighted matches, best match first", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox", { name: "Search hosts and commands" }), "pdb");
    const first = options()[0]!;
    expect(first).toHaveTextContent("prod-db");
    expect(first).toHaveTextContent("deploy@prod-db.example.com:2222");
    expect(within(first).getAllByText(/[pdb]/, { selector: "mark" }).map((m) => m.textContent)).toEqual(["p", "d", "b"]);
  });

  it("finds hosts by address or tag too", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "frontend");
    expect(options()[0]).toHaveTextContent("staging-web");
  });

  it("opens the highlighted host with Enter after moving with the arrows", async () => {
    const { onOpenHost, onOpenChange, user } = setup();
    await user.type(screen.getByRole("combobox"), "prod");
    await user.keyboard("{ArrowDown}");
    const highlighted = options()[1]!;
    expect(highlighted).toHaveAttribute("aria-selected", "true");
    const expected = hosts.find((h) => highlighted.textContent?.startsWith(h.label))!;
    await user.keyboard("{Enter}");
    expect(onOpenHost).toHaveBeenCalledExactlyOnceWith(expected);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens SFTP to the highlighted host with Shift+Enter", async () => {
    const { onOpenHost, onOpenSftp, user } = setup();
    await user.type(screen.getByRole("combobox"), "staging");
    expect(options()[0]).toHaveTextContent("SFTP ⇧↵");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onOpenSftp).toHaveBeenCalledExactlyOnceWith(hosts[2]);
    expect(onOpenHost).not.toHaveBeenCalled();
  });

  it("finds snippets by name and runs the chosen one", async () => {
    const onRunSnippet = vi.fn();
    const snippet = { id: "s1", name: "Restart nginx", command: "sudo systemctl restart nginx\nsystemctl status nginx", description: "", tags: [] };
    render(<CommandPalette open onOpenChange={vi.fn()} hosts={[]} recentHostIds={[]} commands={[]} onOpenHost={vi.fn()} snippets={[snippet]} onRunSnippet={onRunSnippet} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox"), "restart ng");
    expect(screen.getByText("Snippets")).toBeInTheDocument();
    expect(options()[0]).toHaveTextContent("sudo systemctl restart nginx");
    expect(options()[0]).not.toHaveTextContent("Connect");
    await user.keyboard("{Enter}");
    expect(onRunSnippet).toHaveBeenCalledWith(snippet);
  });

  it("wraps around with ArrowUp from the top", async () => {
    const { user } = setup();
    await user.keyboard("{ArrowUp}");
    expect(options().at(-1)).toHaveAttribute("aria-selected", "true");
  });

  it("runs a command on click and shows its shortcut", async () => {
    const { newHost, user } = setup();
    await user.type(screen.getByRole("combobox"), "new");
    const option = options().find((o) => o.textContent?.includes("New host"))!;
    expect(option).toHaveTextContent("⌘N");
    await user.click(option);
    expect(newHost).toHaveBeenCalledOnce();
  });

  it("says when nothing matches", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByText(/No matches for/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
  });
});

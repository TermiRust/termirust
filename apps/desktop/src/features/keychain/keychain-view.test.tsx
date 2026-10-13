import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyView } from "@/bindings";

const commands = {
  keysList: vi.fn(),
  keysImport: vi.fn(),
  keysImportFile: vi.fn(),
  keysGenerate: vi.fn(),
  keysDelete: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));
const openFileDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => openFileDialog(...args) }));

const { useKeysStore } = await import("@/stores/keys-store");
const { KeychainView } = await import("./keychain-view");

const key = (id: string, overrides: Partial<KeyView> = {}): KeyView => ({
  id,
  label: id,
  keyType: "ed25519",
  fingerprint: `SHA256:${id}`,
  publicKey: `ssh-ed25519 AAAA${id}`,
  encrypted: false,
  hasSavedPassphrase: false,
  usedBy: [],
  ...overrides,
});
const ok = <T,>(data: T) => ({ status: "ok", data });
const initial = useKeysStore.getState();

function renderWith(keys: KeyView[]) {
  commands.keysList.mockResolvedValue(ok(keys));
  const user = userEvent.setup();
  render(<KeychainView />);
  return user;
}

describe("KeychainView", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
    openFileDialog.mockReset();
    useKeysStore.setState(initial, true);
  });

  it("explains how to start when there are no keys", async () => {
    renderWith([]);
    expect(await screen.findByText("No keys yet")).toBeInTheDocument();
  });

  it("lists keys with type, fingerprint, passphrase state and usage", async () => {
    renderWith([key("laptop", { encrypted: true, usedBy: ["prod-api", "db"] }), key("ci", { encrypted: true, hasSavedPassphrase: true })]);
    const laptop = await screen.findByRole("listitem", { name: "laptop" });
    expect(laptop).toHaveTextContent("ed25519");
    expect(laptop).toHaveTextContent("SHA256:laptop");
    expect(laptop).toHaveTextContent("Used by prod-api, db");
    expect(laptop).toHaveTextContent("passphrase");
    expect(screen.getByRole("listitem", { name: "ci" })).toHaveTextContent("passphrase saved");
  });

  it("copies the public key", async () => {
    const user = renderWith([key("laptop")]);
    const row = await screen.findByRole("listitem", { name: "laptop" });
    await user.click(within(row).getByRole("button", { name: /Copy public key/ }));
    expect(await navigator.clipboard.readText()).toBe("ssh-ed25519 AAAAlaptop");
    expect(within(row).getByRole("button", { name: /Copied/ })).toBeInTheDocument();
  });

  it("deletes after a confirming second click", async () => {
    commands.keysDelete.mockResolvedValue(ok(null));
    const user = renderWith([key("old")]);
    const button = await screen.findByRole("button", { name: "Delete old" });
    await user.click(button);
    expect(commands.keysDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete old" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "old" })).not.toBeInTheDocument());
    expect(commands.keysDelete).toHaveBeenCalledWith("old");
  });

  it("shows why a key in use cannot be deleted", async () => {
    commands.keysDelete.mockResolvedValue({ status: "error", error: { code: "invalid_data", message: "identity is used by 1 host(s): prod" } });
    const user = renderWith([key("used", { usedBy: ["prod"] })]);
    await user.click(await screen.findByRole("button", { name: "Delete used" }));
    await user.click(screen.getByRole("button", { name: "Delete used" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("used by 1 host(s): prod");
    expect(screen.getByRole("listitem", { name: "used" })).toBeInTheDocument();
  });

  it("imports pasted key text and lists it", async () => {
    commands.keysImport.mockResolvedValue(ok(key("pasted")));
    const user = renderWith([]);
    await user.click(await screen.findByRole("button", { name: "Import key" }));
    const dialog = screen.getByRole("dialog", { name: "Import private key" });
    await user.click(within(dialog).getByRole("radio", { name: "Paste text" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Private key" }), "-----BEGIN OPENSSH PRIVATE KEY-----");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "pasted");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(commands.keysImport).toHaveBeenCalledWith("pasted", "-----BEGIN OPENSSH PRIVATE KEY-----", null, false);
    expect(screen.getByRole("listitem", { name: "pasted" })).toBeInTheDocument();
  });

  it("explains a missing or wrong passphrase in plain words", async () => {
    commands.keysImport.mockResolvedValue({ status: "error", error: { code: "wrong_passphrase", message: "wrong passphrase" } });
    const user = renderWith([]);
    await user.click(await screen.findByRole("button", { name: "Import key" }));
    await user.click(screen.getByRole("radio", { name: "Paste text" }));
    await user.type(screen.getByRole("textbox", { name: "Private key" }), "x");
    await user.type(screen.getByLabelText("Passphrase"), "bad");
    await user.click(screen.getByRole("checkbox", { name: /Remember passphrase/ }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That passphrase is not correct.");
    expect(commands.keysImport).toHaveBeenCalledWith("", "x", "bad", true);
  });

  it("imports a key file picked with the system dialog", async () => {
    openFileDialog.mockResolvedValue("/Users/me/.ssh/id_ed25519");
    commands.keysImportFile.mockResolvedValue(ok(key("id_ed25519")));
    const user = renderWith([]);
    await user.click(await screen.findByRole("button", { name: "Import key" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose a key file");

    await user.click(within(dialog).getByRole("button", { name: /Choose…/ }));
    expect(await within(dialog).findByText("/Users/me/.ssh/id_ed25519")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(commands.keysImportFile).toHaveBeenCalledWith("", "/Users/me/.ssh/id_ed25519", null, false));
  });

  it("generates a key and shows the public key to install", async () => {
    commands.keysGenerate.mockResolvedValue(ok(key("deploy@laptop", { publicKey: "ssh-ed25519 AAAAnew deploy@laptop" })));
    const user = renderWith([]);
    await user.click(await screen.findByRole("button", { name: "Generate key" }));
    const dialog = screen.getByRole("dialog", { name: "Generate ed25519 key" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "deploy@laptop");
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));

    expect(await within(dialog).findByText("ssh-ed25519 AAAAnew deploy@laptop")).toBeInTheDocument();
    expect(commands.keysGenerate).toHaveBeenCalledWith("deploy@laptop");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("listitem", { name: "deploy@laptop" })).toBeInTheDocument();
  });

  it("shows a vault error", async () => {
    commands.keysList.mockResolvedValue({ status: "error", error: { code: "keychain", message: "keychain locked" } });
    render(<KeychainView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("keychain locked");
  });
});

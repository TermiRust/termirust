import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupView, HostView } from "@/bindings";

const commands = {
  hostsList: vi.fn(),
  groupsList: vi.fn(),
  hostsCreate: vi.fn(),
  hostsUpdate: vi.fn(),
  hostsDelete: vi.fn(),
  groupsCreate: vi.fn(),
  keysList: vi.fn(),
  keysImport: vi.fn(),
  keysImportFile: vi.fn(),
  sshConfigPreview: vi.fn(),
  sshConfigImport: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const { useHostsStore } = await import("@/stores/hosts-store");
const { useLayoutStore } = await import("@/stores/layout-store");
const { useKeysStore } = await import("@/stores/keys-store");
const { Sidebar } = await import("./sidebar");

const host = (id: string, overrides: Partial<HostView> = {}): HostView => ({
  id,
  label: id,
  hostname: `${id}.example.com`,
  port: 22,
  username: "deploy",
  auth: { method: "password", hasSavedPassword: false },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null,
  ...overrides,
});
const prod: GroupView = { id: "g1", name: "Production", parentId: null };
const ok = <T,>(data: T) => ({ status: "ok", data });

async function renderWith(hosts: HostView[], groups: GroupView[] = []) {
  commands.hostsList.mockResolvedValue(ok(hosts));
  commands.groupsList.mockResolvedValue(ok(groups));
  await useHostsStore.getState().load();
  const onOpenHost = vi.fn();
  render(<Sidebar onOpenHost={onOpenHost} />);
  return { onOpenHost, user: userEvent.setup() };
}

const initialHosts = useHostsStore.getState();
const initialLayout = useLayoutStore.getState();
const initialKeys = useKeysStore.getState();

describe("Sidebar", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
    useHostsStore.setState(initialHosts, true);
    useLayoutStore.setState(initialLayout, true);
    useKeysStore.setState(initialKeys, true);
    commands.keysList.mockResolvedValue(ok([]));
  });

  it("shows an empty state when the vault has no hosts", async () => {
    await renderWith([]);
    expect(screen.getByText("No hosts yet.")).toBeInTheDocument();
  });

  it("lists hosts under their group with a count, and ungrouped hosts below", async () => {
    await renderWith([host("api", { groupId: "g1" }), host("laptop")], [prod]);
    const list = screen.getByRole("list", { name: "Hosts" });
    const groupButton = within(list).getByRole("button", { name: /Production/ });
    expect(groupButton).toHaveTextContent("1");
    expect(within(list).getByRole("button", { name: "Connect to api" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Connect to laptop" })).toBeInTheDocument();
  });

  it("collapses and expands a group", async () => {
    const { user } = await renderWith([host("api", { groupId: "g1" })], [prod]);
    await user.click(screen.getByRole("button", { name: /Production/ }));
    expect(screen.queryByRole("button", { name: "Connect to api" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Production/ }));
    expect(screen.getByRole("button", { name: "Connect to api" })).toBeInTheDocument();
  });

  it("filters hosts as you type and explains when nothing matches", async () => {
    const { user } = await renderWith([host("api", { tags: ["eu"] }), host("db")]);
    const filter = screen.getByRole("searchbox", { name: "Filter hosts" });
    await user.type(filter, "eu");
    expect(screen.getByRole("button", { name: "Connect to api" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect to db" })).not.toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "nothing");
    expect(screen.getByText(/No host matches/)).toBeInTheDocument();
  });

  it("opens a host on double-click and on Enter", async () => {
    const { onOpenHost, user } = await renderWith([host("api")]);
    const row = screen.getByRole("button", { name: "Connect to api" });
    await user.dblClick(row);
    row.focus();
    await user.keyboard("{Enter}");
    expect(onOpenHost).toHaveBeenCalledTimes(2);
    expect(onOpenHost.mock.calls[0]?.[0]).toMatchObject({ id: "api" });
  });

  it("creates a host from the dialog and shows it in the list", async () => {
    const { user } = await renderWith([]);
    commands.hostsCreate.mockImplementation(async (input) => ok(host("new", { label: input.label, hostname: input.hostname })));

    await user.click(screen.getByRole("button", { name: "New host" }));
    const dialog = screen.getByRole("dialog", { name: "New host" });
    await user.type(within(dialog).getByLabelText("Label"), "web-1");
    await user.type(within(dialog).getByRole("textbox", { name: "Host" }), "10.0.0.9");
    await user.type(within(dialog).getByLabelText("Password"), "s3cret");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(commands.hostsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "web-1",
        hostname: "10.0.0.9",
        auth: { method: "password", password: { kind: "set", value: "s3cret" } },
      }),
    );
    expect(screen.getByRole("button", { name: "Connect to web-1" })).toBeInTheDocument();
  });

  it("keeps the dialog open with the field error when validation fails", async () => {
    const { user } = await renderWith([]);
    await user.click(screen.getByRole("button", { name: "New host" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Host is required")).toBeInTheDocument();
    expect(commands.hostsCreate).not.toHaveBeenCalled();
  });

  it("shows the backend error inside the dialog", async () => {
    const { user } = await renderWith([]);
    commands.hostsCreate.mockResolvedValue({ status: "error", error: { code: "storage", message: "disk full" } });
    await user.click(screen.getByRole("button", { name: "New host" }));
    await user.type(screen.getByRole("textbox", { name: "Host" }), "h");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits a host and keeps its saved password unless asked otherwise", async () => {
    const saved = host("api", { auth: { method: "password", hasSavedPassword: true } });
    const { user } = await renderWith([saved]);
    commands.hostsUpdate.mockImplementation(async (id, input) => ok({ ...saved, id, label: input.label }));

    await user.click(screen.getByRole("button", { name: "Edit api" }));
    const dialog = screen.getByRole("dialog", { name: "Edit api" });
    expect(within(dialog).queryByLabelText("Password")).not.toBeInTheDocument();
    const label = within(dialog).getByLabelText("Label");
    await user.clear(label);
    await user.type(label, "api-renamed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(commands.hostsUpdate).toHaveBeenCalledWith(
        "api",
        expect.objectContaining({ label: "api-renamed", auth: { method: "password", password: { kind: "keep" } } }),
      ),
    );
    expect(await screen.findByRole("button", { name: "Connect to api-renamed" })).toBeInTheDocument();
  });

  it("asks for a second click before deleting a host", async () => {
    const { user } = await renderWith([host("api")]);
    commands.hostsDelete.mockResolvedValue(ok(null));

    await user.click(screen.getByRole("button", { name: "Edit api" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(commands.hostsDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Click again to delete" }));

    await waitFor(() => expect(commands.hostsDelete).toHaveBeenCalledWith("api"));
    expect(screen.queryByRole("button", { name: "Connect to api" })).not.toBeInTheDocument();
  });

  it("creates a group", async () => {
    const { user } = await renderWith([]);
    commands.groupsCreate.mockResolvedValue(ok({ id: "g2", name: "Staging", parentId: null }));
    await user.click(screen.getByRole("button", { name: "New group" }));
    await user.type(screen.getByLabelText("Name"), "Staging");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(commands.groupsCreate).toHaveBeenCalledWith("Staging", null);
    expect(await screen.findByRole("button", { name: /Staging/ })).toBeInTheDocument();
  });

  it("shows a load error from the vault", async () => {
    commands.hostsList.mockResolvedValue({ status: "error", error: { code: "keychain", message: "keychain locked" } });
    commands.groupsList.mockResolvedValue(ok([]));
    await useHostsStore.getState().load();
    render(<Sidebar onOpenHost={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("keychain locked");
  });

  it("saves and connects in one step", async () => {
    const { onOpenHost, user } = await renderWith([]);
    commands.hostsCreate.mockImplementation(async (input) => ok(host("new", { label: input.label || input.hostname })));
    await user.click(screen.getByRole("button", { name: "New host" }));
    await user.type(screen.getByRole("textbox", { name: "Host" }), "10.0.0.7");
    await user.click(screen.getByRole("button", { name: "Save & Connect" }));

    await waitFor(() => expect(onOpenHost).toHaveBeenCalledWith(expect.objectContaining({ id: "new" })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("logs in with a key chosen from the Keychain, or one imported on the spot", async () => {
    commands.keysList.mockResolvedValue(
      ok([{ id: "k1", label: "laptop", keyType: "ed25519", fingerprint: "SHA256:abcdefghijklmnopqrstu", publicKey: "", encrypted: false, hasSavedPassphrase: false, usedBy: [] }]),
    );
    const { user } = await renderWith([]);
    commands.hostsCreate.mockImplementation(async (input) => ok(host("k", { label: input.hostname })));
    await user.click(screen.getByRole("button", { name: "New host" }));
    const dialog = screen.getByRole("dialog", { name: "New host" });
    await user.type(within(dialog).getByRole("textbox", { name: "Host" }), "github.com");
    await user.click(within(dialog).getByRole("radio", { name: "Key" }));

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Choose a key")).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Key" }), "k1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(commands.hostsCreate).toHaveBeenCalledWith(expect.objectContaining({ auth: { method: "identity", identityId: "k1" } })),
    );
  });

  it("selects a key imported from inside the host dialog", async () => {
    const { user } = await renderWith([]);
    commands.keysImport.mockResolvedValue(
      ok({ id: "k9", label: "fresh", keyType: "ed25519", fingerprint: "SHA256:zzzzzzzzzzzzzzzzzzzzz", publicKey: "", encrypted: false, hasSavedPassphrase: false, usedBy: [] }),
    );
    await user.click(screen.getByRole("button", { name: "New host" }));
    await user.click(screen.getByRole("radio", { name: "Key" }));
    await user.click(screen.getByRole("button", { name: "Import key" }));
    const importDialog = screen.getByRole("dialog", { name: "Import private key" });
    await user.click(within(importDialog).getByRole("radio", { name: "Paste text" }));
    await user.type(within(importDialog).getByRole("textbox", { name: "Private key" }), "pem");
    await user.click(within(importDialog).getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Key" })).toHaveValue("k9"));
  });

  it("uses the running ssh-agent without storing anything", async () => {
    const { user } = await renderWith([]);
    commands.hostsCreate.mockImplementation(async (input) => ok(host("a", { label: input.hostname })));
    await user.click(screen.getByRole("button", { name: "New host" }));
    await user.type(screen.getByRole("textbox", { name: "Host" }), "box");
    await user.click(screen.getByRole("radio", { name: "Agent" }));
    expect(screen.getByText(/ssh-agent/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commands.hostsCreate).toHaveBeenCalledWith(expect.objectContaining({ auth: { method: "agent" } })));
  });
});

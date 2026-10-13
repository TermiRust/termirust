import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupView, HostView } from "@/bindings";

const commands = {
  hostsList: vi.fn(),
  groupsList: vi.fn(),
  hostsCreate: vi.fn(),
  hostsUpdate: vi.fn(),
  hostsDelete: vi.fn(),
  hostsMove: vi.fn(),
  groupsCreate: vi.fn(),
  groupsUpdate: vi.fn(),
  groupsDelete: vi.fn(),
  vaultRetryOpen: vi.fn(),
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
const { AppDialogs } = await import("./app-dialogs");
const { useDialogsStore } = await import("@/stores/dialogs-store");

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
  keepaliveSecs: null, aiDisabled: false, os: null, environment: null,
  color: null,
  ...overrides,
});
const prod: GroupView = { id: "g1", name: "Production", parentId: null , color: null, warningBorder: false, aiDisabled: false };
const ok = <T,>(data: T) => ({ status: "ok", data });

async function renderWith(hosts: HostView[], groups: GroupView[] = []) {
  commands.hostsList.mockResolvedValue(ok(hosts));
  commands.groupsList.mockResolvedValue(ok(groups));
  await useHostsStore.getState().load();
  const onOpenHost = vi.fn();
  const onOpenSftp = vi.fn();
  render(
    <>
      <Sidebar onOpenHost={onOpenHost} onOpenSftp={onOpenSftp} />
      <AppDialogs onConnect={onOpenHost} />
    </>,
  );
  return { onOpenHost, onOpenSftp, user: userEvent.setup() };
}

const initialHosts = useHostsStore.getState();
const initialLayout = useLayoutStore.getState();
const initialKeys = useKeysStore.getState();
const initialDialogs = useDialogsStore.getState();

describe("Sidebar", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
    useHostsStore.setState(initialHosts, true);
    useLayoutStore.setState(initialLayout, true);
    useKeysStore.setState(initialKeys, true);
    useDialogsStore.setState(initialDialogs, true);
    commands.keysList.mockResolvedValue(ok([]));
  });

  it("shows an empty state when the vault has no hosts", async () => {
    await renderWith([]);
    expect(screen.getByText("No hosts yet.")).toBeInTheDocument();
  });

  it("lists hosts under their group with a count, and ungrouped hosts below", async () => {
    await renderWith([host("api", { groupId: "g1" }), host("laptop")], [prod]);
    const list = screen.getByRole("list", { name: "Hosts" });
    const groupButton = within(list).getByRole("button", { name: /Production/, expanded: true });
    expect(groupButton).toHaveTextContent("1");
    expect(within(list).getByRole("button", { name: "Connect to api" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Connect to laptop" })).toBeInTheDocument();
  });

  it("shows each host's status from its open tabs, and its first tag", async () => {
    const { useTabsStore } = await import("@/stores/tabs-store");
    useTabsStore.setState({ tabs: [], activeTabId: null });
    await renderWith([host("api", { tags: ["nginx"] }), host("db")]);
    const api = screen.getByRole("button", { name: "Connect to api" });
    expect(within(api).getByRole("img", { name: "Not open" })).toBeInTheDocument();
    expect(api).toHaveTextContent("nginx");

    const tabId = useTabsStore.getState().openHostTab(host("api"), null);
    act(() => useTabsStore.getState().setTabStatus(tabId, "connected"));
    expect(within(screen.getByRole("button", { name: "Connect to api" })).getByRole("img", { name: "Connected" })).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Connect to db" })).getByRole("img", { name: "Not open" })).toBeInTheDocument();
    act(() => useTabsStore.setState({ tabs: [], activeTabId: null }));
  });

  it("moves a host into a group by dragging it onto the group", async () => {
    commands.hostsMove.mockResolvedValue(ok({ ...host("laptop"), groupId: "g1" }));
    await renderWith([host("api", { groupId: "g1" }), host("laptop")], [prod]);
    const group = screen.getByRole("button", { name: /Production/, expanded: true });
    document.elementFromPoint = vi.fn(() => group);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Connect to laptop" }), { button: 0, clientX: 0, clientY: 0 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 0, clientY: 60 });
    });
    act(() => {
      fireEvent.pointerUp(window);
    });
    await waitFor(() => expect(commands.hostsMove).toHaveBeenCalledWith("laptop", "g1"));
    expect(useHostsStore.getState().hosts.find((h) => h.id === "laptop")?.groupId).toBe("g1");
  });

  it("opens an SFTP tab from a host row", async () => {
    const { user, onOpenSftp, onOpenHost } = await renderWith([host("api")]);
    await user.click(screen.getByRole("button", { name: "Open SFTP to api" }));
    expect(onOpenSftp).toHaveBeenCalledWith(expect.objectContaining({ id: "api" }));
    expect(onOpenHost).not.toHaveBeenCalled();
  });

  it("separates the host library from the open terminals, counting tabs", async () => {
    const { useTabsStore } = await import("@/stores/tabs-store");
    const { user } = await renderWith([host("api")]);
    await user.click(screen.getByRole("button", { name: "Hosts" }));
    expect(useLayoutStore.getState().section).toBe("library");
    act(() => {
      useTabsStore.getState().openLocalTab();
    });
    expect(screen.getByRole("button", { name: /Terminals/ })).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: /Terminals/ }));
    expect(useLayoutStore.getState().section).toBe("hosts");
    act(() => useTabsStore.setState({ tabs: [], activeTabId: null }));
  });

  it("opens the Port forwarding screen from the section list", async () => {
    const { user } = await renderWith([host("api")]);
    await user.click(screen.getByRole("button", { name: "Port forwarding" }));
    expect(useLayoutStore.getState().section).toBe("forwards");
    expect(screen.getByRole("button", { name: "Port forwarding" })).toHaveAttribute("aria-current", "page");
  });

  it("collapses and expands a group", async () => {
    const { user } = await renderWith([host("api", { groupId: "g1" })], [prod]);
    await user.click(screen.getByRole("button", { name: /Production/, expanded: true }));
    expect(screen.queryByRole("button", { name: "Connect to api" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Production/, expanded: false }));
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

  it("edits a group's colour, warning border and AI switch", async () => {
    commands.groupsUpdate = vi.fn().mockResolvedValue(ok({ ...prod, color: "red", warningBorder: true }));
    const { user } = await renderWith([host("api", { groupId: "g1" })], [prod]);
    await user.click(screen.getByRole("button", { name: "Edit group Production" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Production" });
    await user.click(within(dialog).getByRole("radio", { name: "red" }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Warning border/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Turn off AI/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(commands.groupsUpdate).toHaveBeenCalledWith("g1", "Production", "red", true, true));
    expect(useHostsStore.getState().groups[0]).toMatchObject({ color: "red", warningBorder: true });
  });

  it("deletes a group after confirmation and reloads hosts", async () => {
    commands.groupsDelete = vi.fn().mockResolvedValue(ok(null));
    const { user } = await renderWith([host("api", { groupId: "g1" })], [prod]);
    commands.hostsList.mockResolvedValue(ok([host("api")]));
    commands.groupsList.mockResolvedValue(ok([]));
    await user.click(screen.getByRole("button", { name: "Edit group Production" }));
    await user.click(screen.getByRole("button", { name: "Delete group" }));
    await user.click(screen.getByRole("button", { name: "Click again to delete" }));

    await waitFor(() => expect(commands.groupsDelete).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Production/, expanded: true })).not.toBeInTheDocument());
  });

  it("creates a group", async () => {
    const { user } = await renderWith([]);
    commands.groupsCreate.mockResolvedValue(ok({ id: "g2", name: "Staging", parentId: null , color: null, warningBorder: false, aiDisabled: false }));
    await user.click(screen.getByRole("button", { name: "New group" }));
    await user.type(screen.getByLabelText("Name"), "Staging");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(commands.groupsCreate).toHaveBeenCalledWith("Staging", null);
    expect(await screen.findByRole("button", { name: /Staging/, expanded: true })).toBeInTheDocument();
  });

  it("says the vault is unlocking until the first load finishes", () => {
    render(<Sidebar onOpenHost={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Unlocking vault…");
    expect(screen.queryByText("No hosts yet.")).not.toBeInTheDocument();
  });

  it("shows a vault error and recovers with Try again", async () => {
    commands.hostsList.mockResolvedValueOnce({ status: "error", error: { code: "keychain", message: "keychain access denied" } });
    commands.groupsList.mockResolvedValue(ok([]));
    await useHostsStore.getState().load();
    render(<Sidebar onOpenHost={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("keychain access denied");

    commands.vaultRetryOpen.mockResolvedValue(ok(null));
    commands.hostsList.mockResolvedValue(ok([host("api")]));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Connect to api" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the error when retrying fails again", async () => {
    commands.hostsList.mockResolvedValue({ status: "error", error: { code: "keychain", message: "denied" } });
    commands.groupsList.mockResolvedValue(ok([]));
    await useHostsStore.getState().load();
    render(<Sidebar onOpenHost={vi.fn()} />);
    commands.vaultRetryOpen.mockResolvedValue({ status: "error", error: { code: "keychain", message: "still denied" } });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("still denied");
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

  it("marks a new host as production and shows its PROD badge", async () => {
    const { user } = await renderWith([]);
    commands.hostsCreate.mockImplementation(async (input) => ok(host("a", { label: input.hostname, environment: input.environment })));
    await user.click(screen.getByRole("button", { name: "New host" }));
    await user.type(screen.getByRole("textbox", { name: "Host" }), "db-prod");
    await user.click(screen.getByRole("radio", { name: "PROD" }));
    expect(screen.getByText("Terminals show a PROD watermark")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commands.hostsCreate).toHaveBeenCalledWith(expect.objectContaining({ environment: "production" })));
    expect(await screen.findByTitle("Production")).toHaveTextContent("PROD");
  });
});

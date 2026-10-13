import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileEntry, HostView, TransferEvent } from "@/bindings";
import { FakeChannel } from "@/test/tauri-channel-mock";

vi.mock("@tauri-apps/api/core", async () => ({ Channel: (await import("@/test/tauri-channel-mock")).FakeChannel }));

type DropHandler = (event: { payload: { type: string; paths?: string[]; position?: { x: number; y: number } } }) => void;
let dropHandler: DropHandler | null = null;
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: DropHandler) => {
      dropHandler = handler;
      return Promise.resolve(() => {
        dropHandler = null;
      });
    },
  }),
}));

const commands = {
  sftpOpen: vi.fn(),
  sftpList: vi.fn(),
  sftpCreateDir: vi.fn(),
  sftpRename: vi.fn(),
  sftpRemove: vi.fn(),
  sftpClose: vi.fn(),
  sftpTransferStart: vi.fn(),
  sftpTransferCancel: vi.fn(),
  localHome: vi.fn(),
  localList: vi.fn(),
  localCreateDir: vi.fn(),
  localRename: vi.fn(),
  localRemove: vi.fn(),
};
vi.mock("@/bindings", () => ({ commands }));

const { SftpView } = await import("./sftp-view");
const { useTransfersStore } = await import("@/stores/transfers-store");

const host: HostView = {
  id: "h1",
  label: "prod-api",
  hostname: "10.0.0.1",
  port: 22,
  username: "deploy",
  auth: { method: "password", hasSavedPassword: true },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null, aiDisabled: false, os: null,
  color: null,
};
const ok = (data: unknown) => ({ status: "ok", data });

const entry = (path: string, kind: FileEntry["kind"] = "file", size = 10): FileEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  kind,
  size,
  modified: null,
  permissions: null,
});

const localTree: Record<string, FileEntry[]> = {
  "/Users/me": [entry("/Users/me/Projects", "directory"), entry("/Users/me/notes.txt"), entry("/Users/me/report.pdf")],
  "/Users/me/Projects": [entry("/Users/me/Projects/site", "directory")],
};
const remoteTree: Record<string, FileEntry[]> = {
  "/home/deploy": [entry("/home/deploy/logs", "directory"), entry("/home/deploy/report.pdf")],
  "/home/deploy/logs": [entry("/home/deploy/logs/app.log", "file", 2048)],
  "/home": [entry("/home/deploy", "directory")],
};

const panel = (name: string) => screen.getByRole("region", { name: `${name} files` });
const list = (name: string) => within(panel(name)).getByRole("listbox");
const row = (name: string, item: string) => within(list(name)).getByRole("option", { name: new RegExp(item) });
const lastChannel = () => FakeChannel.created.at(-1) as FakeChannel<TransferEvent>;

async function renderConnected() {
  render(<SftpView host={host} />);
  await screen.findByRole("option", { name: /logs/ });
  await screen.findByRole("option", { name: /notes\.txt/ });
}

describe("SftpView", () => {
  beforeEach(() => {
    Object.values(commands).forEach((fn) => fn.mockReset());
    FakeChannel.created = [];
    dropHandler = null;
    useTransfersStore.setState({ items: [] });
    commands.sftpOpen.mockResolvedValue(ok({ status: "opened", sftpId: 4, home: "/home/deploy" }));
    commands.localHome.mockResolvedValue(ok("/Users/me"));
    commands.localList.mockImplementation((path: string) => Promise.resolve(ok(localTree[path] ?? [])));
    commands.sftpList.mockImplementation((_id: number, path: string) => Promise.resolve(ok(remoteTree[path] ?? [])));
    commands.sftpClose.mockResolvedValue(ok(null));
    commands.sftpTransferStart.mockResolvedValue(ok(1));
    commands.sftpTransferCancel.mockResolvedValue(ok(true));
    commands.sftpCreateDir.mockResolvedValue(ok(null));
    commands.sftpRemove.mockResolvedValue(ok(null));
    commands.localRename.mockResolvedValue(ok(null));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens both homes side by side and closes the session on unmount", async () => {
    const { unmount } = render(<SftpView host={host} />);
    expect(await within(list("prod-api")).findByRole("option", { name: /report\.pdf/ })).toBeInTheDocument();
    expect(within(panel("Local")).getByRole("textbox", { name: "Local path" })).toHaveValue("/Users/me");
    expect(within(panel("prod-api")).getByRole("textbox", { name: "prod-api path" })).toHaveValue("/home/deploy");
    expect(commands.sftpOpen).toHaveBeenCalledWith({ hostId: "h1", prompted: null, confirmedFingerprint: null, rememberHostKey: true });

    unmount();
    expect(commands.sftpClose).toHaveBeenCalledWith(4);
  });

  it("asks for a password the same way a terminal tab does", async () => {
    commands.sftpOpen
      .mockResolvedValueOnce(ok({ status: "needsInput", prompt: { status: "needsPassword", usernameRequired: false, savedPasswordRejected: true } }))
      .mockResolvedValueOnce(ok({ status: "opened", sftpId: 4, home: "/home/deploy" }));
    const user = userEvent.setup();
    render(<SftpView host={host} />);

    const dialog = await screen.findByRole("dialog", { name: "Log in to prod-api" });
    await user.type(within(dialog).getByLabelText("Password"), "pw");
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));

    expect(await within(list("prod-api")).findByRole("option", { name: /logs/ })).toBeInTheDocument();
    expect(commands.sftpOpen.mock.calls[1]?.[0]).toMatchObject({ prompted: { password: "pw", remember: true } });
  });

  it("shows connection errors with a way to reconnect", async () => {
    commands.sftpOpen.mockResolvedValueOnce({ status: "error", error: { code: "unreachable", message: "connection refused" } });
    const user = userEvent.setup();
    render(<SftpView host={host} />);
    expect(await screen.findByText("connection refused")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(await within(list("prod-api")).findByRole("option", { name: /logs/ })).toBeInTheDocument();
  });

  it("enters folders on double-click, goes up, and accepts a typed path", async () => {
    const user = userEvent.setup();
    await renderConnected();

    await user.dblClick(row("prod-api", "logs"));
    expect(await within(list("prod-api")).findByRole("option", { name: /app\.log/ })).toBeInTheDocument();
    expect(within(list("prod-api")).getByRole("option", { name: /2\.0 KB/ })).toBeInTheDocument();

    await user.click(within(panel("prod-api")).getByRole("button", { name: "Up one folder (prod-api)" }));
    await user.click(within(panel("prod-api")).getByRole("button", { name: "Up one folder (prod-api)" }));
    expect(await within(list("prod-api")).findByRole("option", { name: /deploy/ })).toBeInTheDocument();

    const path = within(panel("Local")).getByRole("textbox", { name: "Local path" });
    await user.clear(path);
    await user.type(path, "/Users/me/Projects{Enter}");
    expect(await within(list("Local")).findByRole("option", { name: /site/ })).toBeInTheDocument();
  });

  it("sorts by a column, keeping folders on top", async () => {
    const user = userEvent.setup();
    await renderConnected();
    const order = () => within(list("Local")).getAllByRole("option").map((o) => o.getAttribute("title"));
    expect(order()).toEqual(["Projects", "notes.txt", "report.pdf"]);

    await user.click(within(panel("Local")).getByRole("button", { name: "Sort by name" }));
    expect(order()).toEqual(["Projects", "report.pdf", "notes.txt"]);
    expect(within(panel("Local")).getByRole("button", { name: "Sort by name" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports a folder that cannot be listed", async () => {
    commands.sftpList.mockImplementation((_id: number, path: string) =>
      Promise.resolve(path === "/root" ? { status: "error", error: { code: "sftp", message: "permission denied" } } : ok(remoteTree[path] ?? [])),
    );
    const user = userEvent.setup();
    await renderConnected();
    const path = within(panel("prod-api")).getByRole("textbox", { name: "prod-api path" });
    await user.clear(path);
    await user.type(path, "/root{Enter}");
    expect(await within(panel("prod-api")).findByRole("alert")).toHaveTextContent("permission denied");
  });

  it("uploads the selection into the server folder and refreshes it when done", async () => {
    const user = userEvent.setup();
    await renderConnected();

    await user.click(row("Local", "notes.txt"));
    await user.click(screen.getByRole("button", { name: "Upload selected" }));

    expect(commands.sftpTransferStart).toHaveBeenCalledWith(
      { sftpId: 4, direction: "upload", localPath: "/Users/me/notes.txt", remotePath: "/home/deploy/notes.txt" },
      expect.anything(),
    );
    const transfers = await screen.findByRole("region", { name: "Transfers" });
    expect(within(transfers).getByText("Waiting…")).toBeInTheDocument();

    const listsBefore = commands.sftpList.mock.calls.length;
    act(() => lastChannel().emit({ state: "running", done: 5, total: 10, filesDone: 0, filesTotal: 1, current: "/home/deploy/notes.txt" }));
    expect(within(transfers).getByRole("progressbar", { name: "notes.txt progress" })).toHaveAttribute("aria-valuenow", "50");
    act(() => lastChannel().emit({ state: "completed", bytes: 10 }));
    expect(within(transfers).getByText("Done · 10 B")).toBeInTheDocument();
    await waitFor(() => expect(commands.sftpList.mock.calls.length).toBeGreaterThan(listsBefore));
  });

  it("downloads a file on double-click", async () => {
    const user = userEvent.setup();
    await renderConnected();
    await user.dblClick(row("prod-api", "logs"));
    await user.dblClick(await within(list("prod-api")).findByRole("option", { name: /app\.log/ }));
    expect(commands.sftpTransferStart).toHaveBeenCalledWith(
      { sftpId: 4, direction: "download", localPath: "/Users/me/app.log", remotePath: "/home/deploy/logs/app.log" },
      expect.anything(),
    );
  });

  it("asks before replacing files that already exist on the other side", async () => {
    const user = userEvent.setup();
    await renderConnected();

    await user.click(row("Local", "report.pdf"));
    await user.click(screen.getByRole("button", { name: "Upload selected" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace report.pdf?" });
    expect(commands.sftpTransferStart).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(commands.sftpTransferStart).toHaveBeenCalledTimes(1);
  });

  it("cancels and retries from the queue", async () => {
    const user = userEvent.setup();
    await renderConnected();
    await user.dblClick(row("Local", "notes.txt"));

    const transfers = await screen.findByRole("region", { name: "Transfers" });
    await user.click(within(transfers).getByRole("button", { name: "Cancel notes.txt" }));
    expect(commands.sftpTransferCancel).toHaveBeenCalledWith(1);

    act(() => lastChannel().emit({ state: "failed", message: "disk full" }));
    expect(within(transfers).getByText("disk full")).toBeInTheDocument();
    commands.sftpTransferStart.mockResolvedValue(ok(2));
    await user.click(within(transfers).getByRole("button", { name: "Retry notes.txt" }));
    expect(commands.sftpTransferStart).toHaveBeenCalledTimes(2);

    act(() => lastChannel().emit({ state: "completed", bytes: 10 }));
    await user.click(within(transfers).getByRole("button", { name: "Clear finished" }));
    expect(screen.queryByRole("region", { name: "Transfers" })).not.toBeInTheDocument();
  });

  it("creates a folder after validating its name", async () => {
    const user = userEvent.setup();
    await renderConnected();

    await user.click(within(panel("prod-api")).getByRole("button", { name: "New folder (prod-api)" }));
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "a/b");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(within(dialog).getByText(/cannot contain/)).toBeInTheDocument();

    await user.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "releases");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(commands.sftpCreateDir).toHaveBeenCalledWith(4, "/home/deploy/releases");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the rename dialog open with the reason when renaming fails", async () => {
    commands.localRename.mockResolvedValue({ status: "error", error: { code: "invalid_data", message: "already exists" } });
    const user = userEvent.setup();
    await renderConnected();

    await user.click(row("Local", "notes.txt"));
    fireEvent.keyDown(list("Local"), { key: "F2" });
    const dialog = await screen.findByRole("dialog", { name: "Rename notes.txt" });
    await user.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "report.pdf{Enter}");

    expect(commands.localRename).toHaveBeenCalledWith("/Users/me/notes.txt", "/Users/me/report.pdf");
    expect(await within(dialog).findByText("already exists")).toBeInTheDocument();
  });

  it("deletes the selection after confirmation", async () => {
    const user = userEvent.setup();
    await renderConnected();

    await user.click(row("prod-api", "logs"));
    fireEvent.click(row("prod-api", "report.pdf"), { shiftKey: true });
    expect(within(panel("prod-api")).getByText("2 of 2 selected")).toBeInTheDocument();

    fireEvent.keyDown(list("prod-api"), { key: "Delete" });
    const dialog = await screen.findByRole("dialog", { name: "Delete 2 items?" });
    expect(within(dialog).getByText(/on the server/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(commands.sftpRemove).toHaveBeenCalledTimes(2));
    expect(commands.sftpRemove).toHaveBeenCalledWith(4, "/home/deploy/logs");
  });

  it("moves the selection with arrow keys and opens folders with Enter", async () => {
    await renderConnected();
    fireEvent.keyDown(list("prod-api"), { key: "ArrowDown" });
    expect(row("prod-api", "logs")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list("prod-api"), { key: "Enter" });
    expect(await within(list("prod-api")).findByRole("option", { name: /app\.log/ })).toBeInTheDocument();
    fireEvent.keyDown(list("prod-api"), { key: "Backspace" });
    expect(await within(list("prod-api")).findByRole("option", { name: /logs/ })).toBeInTheDocument();
  });

  it("uploads rows dragged from the local panel onto the server panel", async () => {
    await renderConnected();
    const target = within(list("prod-api")).getAllByRole("option")[0] as HTMLElement;
    document.elementFromPoint = vi.fn(() => target);

    const source = row("Local", "notes.txt");
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 10 });
    expect(panel("prod-api").className).toMatch(/inset/);
    fireEvent.pointerUp(window, { clientX: 300, clientY: 10 });

    expect(commands.sftpTransferStart).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "upload", localPath: "/Users/me/notes.txt" }),
      expect.anything(),
    );
  });

  it("ignores a click that never moved far enough to be a drag", async () => {
    await renderConnected();
    document.elementFromPoint = vi.fn(() => panel("prod-api"));
    const source = row("Local", "notes.txt");
    fireEvent.pointerDown(source, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 11, clientY: 10 });
    expect(commands.sftpTransferStart).not.toHaveBeenCalled();
  });

  it("uploads files dropped from the OS onto the server panel", async () => {
    await renderConnected();
    await waitFor(() => expect(dropHandler).not.toBeNull());
    document.elementFromPoint = vi.fn(() => panel("prod-api"));

    act(() => dropHandler?.({ payload: { type: "over", position: { x: 600, y: 200 } } }));
    expect(panel("prod-api").className).toMatch(/inset/);
    act(() => dropHandler?.({ payload: { type: "drop", paths: ["/tmp/dump.sql"], position: { x: 600, y: 200 } } }));

    expect(commands.sftpTransferStart).toHaveBeenCalledWith(
      { sftpId: 4, direction: "upload", localPath: "/tmp/dump.sql", remotePath: "/home/deploy/dump.sql" },
      expect.anything(),
    );
    expect(panel("prod-api").className).not.toMatch(/inset/);
  });

  it("ignores OS drops outside the server panel", async () => {
    await renderConnected();
    await waitFor(() => expect(dropHandler).not.toBeNull());
    document.elementFromPoint = vi.fn(() => panel("Local"));
    act(() => dropHandler?.({ payload: { type: "drop", paths: ["/tmp/dump.sql"], position: { x: 10, y: 10 } } }));
    expect(commands.sftpTransferStart).not.toHaveBeenCalled();
  });
});

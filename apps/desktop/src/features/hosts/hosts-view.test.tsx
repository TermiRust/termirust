import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupView, HostView } from "@/bindings";

vi.mock("@/bindings", () => ({ commands: {} }));

const { HostsView } = await import("./hosts-view");
const { useHostsStore } = await import("@/stores/hosts-store");
const { useDialogsStore } = await import("@/stores/dialogs-store");
const { useTabsStore } = await import("@/stores/tabs-store");

const host = (id: string, overrides: Partial<HostView> = {}): HostView => ({
  id,
  label: id,
  hostname: `${id}.internal`,
  port: 22,
  username: "deploy",
  auth: { method: "agent" },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null,
  color: null,
  aiDisabled: false,
  os: null,
  environment: null, proxyCommand: null,
  ...overrides,
});
const prod: GroupView = { id: "g1", name: "Production", parentId: null, color: null, warningBorder: false, aiDisabled: false };

function setup(hosts: HostView[] = [host("api", { groupId: "g1", os: "ubuntu", tags: ["nginx"] }), host("nas", { port: 2222 })]) {
  useHostsStore.setState({ hosts, groups: [prod], loaded: true, error: null });
  const onOpenHost = vi.fn();
  const onOpenSftp = vi.fn();
  render(<HostsView onOpenHost={onOpenHost} onOpenSftp={onOpenSftp} />);
  return { onOpenHost, onOpenSftp, user: userEvent.setup() };
}

describe("HostsView", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState({ tabs: [], activeTabId: null });
    useDialogsStore.setState({ hostEditor: null });
  });

  it("shows hosts as cards grouped under their group, with OS logo and address", () => {
    setup();
    const production = screen.getByRole("region", { name: "Production" });
    const api = within(production).getByRole("listitem", { name: "api" });
    expect(within(api).getByRole("img", { name: "Ubuntu" })).toBeInTheDocument();
    expect(api).toHaveTextContent("deploy@api.internal");
    expect(api).toHaveTextContent("nginx");
    expect(within(screen.getByRole("region", { name: "Ungrouped" })).getByRole("listitem", { name: "nas" })).toHaveTextContent("nas.internal:2222");
    expect(screen.getByRole("radio", { name: "Grid view" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches to the list view and remembers it", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: "List view" }));
    expect(screen.getByRole("radio", { name: "List view" })).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem("termirust.hosts.view")).toBe("list");
  });

  it("searches by name, address or tag", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("searchbox", { name: "Search hosts" }), "nginx");
    expect(screen.queryByRole("listitem", { name: "nas" })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search hosts" }));
    await user.type(screen.getByRole("searchbox", { name: "Search hosts" }), "zzz");
    expect(screen.getByText("No host matches “zzz”.")).toBeInTheDocument();
  });

  it("connects, opens SFTP and edits from each host", async () => {
    const { user, onOpenHost, onOpenSftp } = setup();
    await user.click(screen.getByRole("button", { name: "Connect to api" }));
    await user.click(screen.getByRole("button", { name: "Open SFTP to nas" }));
    await user.dblClick(screen.getByRole("listitem", { name: "nas" }));
    await user.click(screen.getByRole("button", { name: "Edit api" }));
    expect(onOpenHost.mock.calls.map((c) => c[0].id)).toEqual(["api", "nas"]);
    expect(onOpenSftp).toHaveBeenCalledWith(expect.objectContaining({ id: "nas" }));
    expect(useDialogsStore.getState().hostEditor).toMatchObject({ mode: "edit" });
  });

  it("explains the empty library", () => {
    setup([]);
    expect(screen.getByText("No hosts yet")).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostView } from "@/bindings";

vi.mock("@/bindings", () => ({ commands: {} }));

const { SftpLauncher } = await import("./sftp-launcher");
const { useHostsStore } = await import("@/stores/hosts-store");

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
  environment: null,
  ...overrides,
});

describe("SftpLauncher", () => {
  beforeEach(() => useHostsStore.setState({ hosts: [host("web"), host("db", { environment: "production", os: "debian" })], groups: [], loaded: true, error: null }));

  it("lists hosts with their OS and environment and connects on click", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<SftpLauncher onOpen={onOpen} />);
    const db = screen.getByRole("button", { name: "Browse files on db" });
    expect(db).toHaveTextContent("PROD");
    expect(screen.getByRole("img", { name: "Debian" })).toBeInTheDocument();
    await user.click(db);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "db" }));
  });

  it("filters as you type and opens the first match with Enter", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<SftpLauncher onOpen={onOpen} />);
    await user.type(screen.getByRole("searchbox", { name: "Find a host for SFTP" }), "web{Enter}");
    expect(screen.queryByRole("button", { name: "Browse files on db" })).not.toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "web" }));
  });

  it("explains when there is nothing to connect to", () => {
    useHostsStore.setState({ hosts: [] });
    render(<SftpLauncher onOpen={vi.fn()} />);
    expect(screen.getByText(/Add a host first/)).toBeInTheDocument();
  });
});

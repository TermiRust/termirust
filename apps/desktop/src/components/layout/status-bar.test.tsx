import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { HostView } from "@/bindings";
import type { Tab } from "@/stores/tabs-store";

import { StatusBar } from "./status-bar";

const host = (id: string, overrides: Partial<HostView> = {}): HostView => ({
  id,
  label: id,
  hostname: `${id}.internal`,
  port: 22,
  username: "deploy",
  auth: { method: "identity", identityId: "k" },
  groupId: null,
  jumpHostId: null,
  tags: [],
  notes: "",
  keepaliveSecs: null, aiDisabled: false, os: null, environment: null,
  color: null,
  ...overrides,
});
const tab = (overrides: Partial<Tab>): Tab => ({
  id: "t",
  title: "t",
  target: { kind: "local" },
  status: "connected",
  color: null,
  size: { cols: 120, rows: 32 },
  layout: { kind: "pane", id: "p" },
  focusedPaneId: "p",
  paneStatus: {},
  broadcast: false,
  ...overrides,
});

describe("StatusBar", () => {
  it("renders nothing without an active tab", () => {
    const { container } = render(<StatusBar tab={undefined} hosts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("describes an SSH tab with its address, jump host, auth and size", () => {
    const bastion = host("bastion");
    const api = host("prod-api", { port: 2222, jumpHostId: "bastion" });
    render(<StatusBar tab={tab({ target: { kind: "host", host: api } })} hosts={[api, bastion]} />);
    const bar = screen.getByRole("contentinfo", { name: "Status bar" });
    expect(bar).toHaveTextContent("deploy@prod-api");
    expect(bar).toHaveTextContent("prod-api.internal:2222");
    expect(bar).toHaveTextContent("via bastion");
    expect(bar).toHaveTextContent("key");
    expect(bar).toHaveTextContent("120 × 32");
    expect(screen.getByLabelText("Status: connected")).toBeInTheDocument();
  });

  it("marks an SFTP tab and leaves out terminal-only facts", () => {
    const api = host("prod-api");
    render(<StatusBar tab={tab({ target: { kind: "sftp", host: api }, size: null })} hosts={[api]} />);
    const bar = screen.getByRole("contentinfo", { name: "Status bar" });
    expect(bar).toHaveTextContent("deploy@prod-api");
    expect(bar).toHaveTextContent("SFTP");
    expect(bar).not.toHaveTextContent("xterm-256color");
  });

  it("uses the latest saved host details rather than the ones the tab opened with", () => {
    const opened = host("db", { hostname: "old.internal" });
    const edited = host("db", { hostname: "new.internal", auth: { method: "agent" } });
    render(<StatusBar tab={tab({ target: { kind: "host", host: opened } })} hosts={[edited]} />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("new.internal:22");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("agent");
  });

  it("describes a local shell and hides the size until it is known", () => {
    render(<StatusBar tab={tab({ size: null, status: "connecting" })} hosts={[]} />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Local shell");
    expect(screen.getByRole("contentinfo")).not.toHaveTextContent("×");
    expect(screen.getByLabelText("Status: connecting")).toBeInTheDocument();
  });
});

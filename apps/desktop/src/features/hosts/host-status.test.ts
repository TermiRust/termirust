import { describe, expect, it } from "vitest";

import type { HostView } from "@/bindings";
import type { Tab, TabStatus } from "@/stores/tabs-store";

import { dotForStatus, hostDot } from "./host-status";

const host = { id: "h1" } as HostView;
const tab = (status: TabStatus, kind: "host" | "sftp" | "local" = "host", id = "h1"): Tab =>
  ({ id: `${kind}-${status}`, title: "", status, color: null, size: null, layout: { kind: "pane", id: "p" }, paneTargets: {}, focusedPaneId: "p", paneStatus: {}, broadcast: false, target: kind === "local" ? { kind } : { kind, host: { ...host, id } } }) as Tab;

describe("host status dots", () => {
  it("maps tab states to colours", () => {
    expect(["connected", "connecting", "error", "disconnected", "idle"].map((s) => dotForStatus(s as TabStatus))).toEqual(["on", "warn", "err", "err", "idle"]);
  });

  it("is grey when no tab of the host is open", () => {
    expect(hostDot("h1", [])).toBe("idle");
    expect(hostDot("h1", [tab("connected", "local"), tab("connected", "host", "h2")])).toBe("idle");
  });

  it("shows the healthiest of the host's tabs, SFTP included", () => {
    expect(hostDot("h1", [tab("error"), tab("connecting")])).toBe("warn");
    expect(hostDot("h1", [tab("disconnected"), tab("connected", "sftp")])).toBe("on");
    expect(hostDot("h1", [tab("disconnected")])).toBe("err");
  });

  it("counts split panes opened on another host", () => {
    const split = {
      ...tab("connected", "host", "h2"),
      layout: { kind: "split", id: "s", direction: "row", ratio: 0.5, first: { kind: "pane", id: "p" }, second: { kind: "pane", id: "q" } },
      paneTargets: { q: { kind: "host", host: { ...host, id: "h1" } } },
      paneStatus: { p: "connected", q: "connecting" },
    } as Tab;
    expect(hostDot("h1", [split])).toBe("warn");
    expect(hostDot("h2", [split])).toBe("on");
  });
});

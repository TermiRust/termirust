import { describe, expect, it } from "vitest";

import type { AiSettingsView, GroupView, HostView } from "@/bindings";

import { aiAllowedFor } from "./ai-access";

const on: AiSettingsView = { enabled: true, kind: "anthropic", baseUrl: "", model: "", hasApiKey: true };
const host = (overrides: Partial<HostView> = {}): HostView => ({
  id: "h",
  label: "h",
  hostname: "h",
  port: 22,
  username: null,
  auth: { method: "agent" },
  groupId: "g",
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
const group = (aiDisabled: boolean): GroupView => ({ id: "g", name: "prod", parentId: null, color: null, warningBorder: false, aiDisabled });

describe("aiAllowedFor", () => {
  it("is off until AI is enabled", () => {
    expect(aiAllowedFor(null, null, [])).toBe(false);
    expect(aiAllowedFor({ ...on, enabled: false }, host(), [])).toBe(false);
  });

  it("allows local tabs and hosts that did not opt out", () => {
    expect(aiAllowedFor(on, null, [])).toBe(true);
    expect(aiAllowedFor(on, host(), [group(false)])).toBe(true);
  });

  it("respects the host and group switches", () => {
    expect(aiAllowedFor(on, host({ aiDisabled: true }), [])).toBe(false);
    expect(aiAllowedFor(on, host(), [group(true)])).toBe(false);
  });
});

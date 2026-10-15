import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
const check = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a: unknown[]) => check(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@/bindings", () => ({ commands: { appVersion: vi.fn(async () => "0.1.0") } }));

const { AboutSection } = await import("./about-section");
const { useUpdateStore } = await import("@/stores/update-store");
const initial = useUpdateStore.getState();

describe("AboutSection", () => {
  beforeEach(() => {
    openUrl.mockClear();
    check.mockReset();
    useUpdateStore.setState(initial, true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the version, the AGPL notice and links to the source and license", async () => {
    const user = userEvent.setup();
    render(<AboutSection />);
    expect(await screen.findByText(/^v0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/GNU Affero General Public License v3\.0/)).toHaveTextContent("ABSOLUTELY NO WARRANTY");
    await user.click(screen.getByRole("button", { name: "Source code" }));
    await user.click(screen.getByRole("button", { name: "License (AGPL-3.0)" }));
    expect(openUrl.mock.calls.map((c) => c[0])).toEqual(["https://github.com/TermiRust/termirust", "https://github.com/TermiRust/termirust/blob/main/LICENSE"]);
  });

  it("checks for updates on demand and offers to install", async () => {
    check.mockResolvedValueOnce(null).mockResolvedValueOnce({ version: "0.2.0", currentVersion: "0.1.0", body: "", date: null });
    const user = userEvent.setup();
    render(<AboutSection />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Up to date")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Version 0.2.0 is available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install 0.2.0 & restart" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Check for updates automatically/ }));
    expect(useUpdateStore.getState().autoCheck).toBe(false);
  });

  it("lists third-party licenses with their texts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          generatedAt: "2026-10-15",
          packages: [
            { name: "russh", version: "0.54.0", source: "cargo", license: "Apache-2.0", homepage: null, text: "a" },
            { name: "react", version: "19.3.0", source: "npm", license: "MIT", homepage: null, text: null },
          ],
          texts: { a: "Apache License Version 2.0" },
        }),
      })),
    );
    const user = userEvent.setup();
    render(<AboutSection />);
    await user.click(screen.getByRole("button", { name: "Third-party licenses" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Third-party licenses" }));
    const list = within(await dialog.findByRole("list", { name: "Packages" }));
    await user.click(list.getByRole("button", { name: /russh/ }));
    expect(list.getByText("Apache License Version 2.0")).toBeInTheDocument();
    await user.type(dialog.getByRole("searchbox", { name: "Find a package" }), "mit");
    expect(list.queryByRole("button", { name: /russh/ })).not.toBeInTheDocument();
    await user.click(list.getByRole("button", { name: /react/ }));
    expect(list.getByText(/No license file was shipped/)).toBeInTheDocument();
  });
});

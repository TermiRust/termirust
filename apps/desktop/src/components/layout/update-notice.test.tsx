import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

const { UpdateNotice } = await import("./update-notice");
const { useUpdateStore } = await import("@/stores/update-store");

const available = (required: boolean) => ({ version: "0.2.0", currentVersion: "0.1.0", notes: "Fixes host key check.", date: null, required });

describe("UpdateNotice", () => {
  const install = vi.fn(async () => {});
  const dismiss = vi.fn();
  beforeEach(() => {
    install.mockClear();
    dismiss.mockClear();
    openUrl.mockClear();
    useUpdateStore.setState({ phase: "available", available: null, dismissedVersion: null, error: null, progress: null, install, dismiss });
  });

  it("shows nothing without an update", () => {
    render(<UpdateNotice />);
    expect(screen.queryByRole("status", { name: "Update available" })).not.toBeInTheDocument();
  });

  it("offers an optional update in a banner that can be put off", async () => {
    useUpdateStore.setState({ available: available(false) });
    const user = userEvent.setup();
    render(<UpdateNotice />);
    const banner = within(screen.getByRole("status", { name: "Update available" }));
    expect(banner.getByText(/Termirust 0.2.0/)).toBeInTheDocument();
    await user.click(banner.getByRole("button", { name: "What's new" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/TermiRust/termirust/releases/tag/v0.2.0");
    await user.click(banner.getByRole("button", { name: /Install & restart/ }));
    expect(install).toHaveBeenCalled();
    await user.click(banner.getByRole("button", { name: "Remind me later" }));
    expect(dismiss).toHaveBeenCalled();
  });

  it("hides the banner for a version put off earlier", () => {
    useUpdateStore.setState({ available: available(false), dismissedVersion: "0.2.0" });
    render(<UpdateNotice />);
    expect(screen.queryByRole("status", { name: "Update available" })).not.toBeInTheDocument();
  });

  it("blocks the app with a dialog that cannot be closed when the update is required", async () => {
    useUpdateStore.setState({ available: available(true), dismissedVersion: "0.2.0" });
    const user = userEvent.setup();
    render(<UpdateNotice />);
    const dialog = within(screen.getByRole("dialog", { name: "Update required" }));
    expect(dialog.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Update required" })).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: /Install & restart/ }));
    expect(install).toHaveBeenCalled();
  });
});

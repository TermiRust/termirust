import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = { settingsTerminalSet: vi.fn(), logsOpenFolder: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { useSettingsStore } = await import("@/stores/settings-store");
const { SettingsView } = await import("./settings-view");
const initial = useSettingsStore.getState();
const saved = () => commands.settingsTerminalSet.mock.calls.at(-1)?.[0];

describe("SettingsView", () => {
  beforeEach(() => {
    useSettingsStore.setState(initial, true);
    commands.settingsTerminalSet.mockReset();
    commands.settingsTerminalSet.mockImplementation(async (s: unknown) => ({ status: "ok", data: s }));
  });

  it("changes font size within 8–32", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    await user.click(screen.getByRole("button", { name: "Larger font" }));
    expect(screen.getByLabelText("Font size")).toHaveTextContent("14");
    expect(saved()).toMatchObject({ fontSize: 14 });

    useSettingsStore.setState({ terminal: { ...useSettingsStore.getState().terminal, fontSize: 8 } });
    await user.click(screen.getByRole("button", { name: "Smaller font" }));
    expect(saved()).toMatchObject({ fontSize: 8 });
  });

  it("picks a theme from the cards and updates the preview", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    expect(screen.getByRole("radio", { name: "Termirust Dark" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Nord" }));
    expect(screen.getByRole("radio", { name: "Nord" })).toHaveAttribute("aria-checked", "true");
    expect(saved()).toMatchObject({ theme: "nord" });
    const preview = screen.getByRole("figure", { name: "Preview" }).querySelector("div")!;
    expect(preview.style.background).toBe("rgb(46, 52, 64)");
  });

  it("sets font family, line height, cursor and behaviour options", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Font family" }), "Fira Code");
    expect(saved()).toMatchObject({ fontFamily: expect.stringContaining("Fira Code") });
    await user.selectOptions(screen.getByRole("combobox", { name: "Line height" }), "1.4");
    expect(saved()).toMatchObject({ lineHeight: 1.4 });
    await user.click(screen.getByRole("radio", { name: "Bar" }));
    expect(saved()).toMatchObject({ cursorStyle: "bar" });
    await user.click(screen.getByRole("checkbox", { name: /Copy on select/ }));
    expect(saved()).toMatchObject({ copyOnSelect: true });
    await user.click(screen.getByRole("checkbox", { name: /Confirm multi-line paste/ }));
    expect(saved()).toMatchObject({ confirmMultilinePaste: false });
  });

  it("saves scrollback when the field loses focus", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    const field = screen.getByRole("textbox", { name: "Scrollback lines" });
    await user.clear(field);
    await user.type(field, "5000");
    await user.tab();
    await waitFor(() => expect(saved()).toMatchObject({ scrollback: 5000 }));
  });

  it("opens the log folder", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    await user.click(screen.getByRole("button", { name: "Open log folder" }));
    expect(commands.logsOpenFolder).toHaveBeenCalledOnce();
  });

  it("shows a save error", async () => {
    commands.settingsTerminalSet.mockResolvedValue({ status: "error", error: { code: "storage", message: "disk full" } });
    const user = userEvent.setup();
    render(<SettingsView />);
    await user.click(screen.getByRole("checkbox", { name: /Show status bar/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = {
  settingsTerminalSet: vi.fn(),
  logsOpenFolder: vi.fn(),
  aiSettingsGet: vi.fn(async () => ({
    status: "ok",
    data: { enabled: false, kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", hasApiKey: false },
  })),
};
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

  it("follows the app theme by default, or uses a terminal theme of its own", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    const terminalThemes = within(screen.getByRole("radiogroup", { name: "Terminal theme" }));
    expect(terminalThemes.getByRole("radio", { name: "Match app theme" })).toHaveAttribute("aria-checked", "true");
    await user.click(terminalThemes.getByRole("radio", { name: "Nord" }));
    expect(terminalThemes.getByRole("radio", { name: "Nord" })).toHaveAttribute("aria-checked", "true");
    expect(saved()).toMatchObject({ theme: "nord" });
    const preview = screen.getByRole("figure", { name: "Preview" }).querySelector("div")!;
    expect(preview.style.background).toBe("rgb(46, 52, 64)");
  });

  it("changes the whole app's appearance, and the terminal follows it", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    const appearance = within(screen.getByRole("radiogroup", { name: "Appearance" }));
    expect(appearance.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    await user.click(appearance.getByRole("radio", { name: "Dracula" }));
    expect(saved()).toMatchObject({ appTheme: "dracula" });
    const preview = screen.getByRole("figure", { name: "Preview" }).querySelector("div")!;
    expect(preview.style.background).toBe("rgb(40, 42, 54)");
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

  it("imports a Windows Terminal scheme, selects it, and removes it again", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    const scheme = {
      name: "Campbell",
      background: "#0C0C0C",
      foreground: "#CCCCCC",
      black: "#0C0C0C", red: "#C50F1F", green: "#13A10E", yellow: "#C19C00", blue: "#0037DA", purple: "#881798", cyan: "#3A96DD", white: "#CCCCCC",
      brightBlack: "#767676", brightRed: "#E74856", brightGreen: "#16C60C", brightYellow: "#F9F1A5", brightBlue: "#3B78FF", brightPurple: "#B4009E", brightCyan: "#61D6D6", brightWhite: "#F2F2F2",
    };
    const file = new File([JSON.stringify(scheme)], "campbell.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("Import theme file"), file);

    const appearance = () => within(screen.getByRole("radiogroup", { name: "Appearance" }));
    expect(await appearance().findByRole("radio", { name: "Campbell" })).toHaveAttribute("aria-checked", "true");
    expect(saved()).toMatchObject({ appTheme: "custom-campbell", customThemes: [expect.objectContaining({ id: "custom-campbell" })] });

    await user.click(appearance().getByRole("button", { name: "Remove Campbell" }));
    expect(screen.queryByRole("radio", { name: "Campbell" })).not.toBeInTheDocument();
    expect(saved()).toMatchObject({ appTheme: "system", customThemes: [] });
  });

  it("explains why a theme file could not be imported", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<SettingsView />);
    await user.upload(screen.getByLabelText("Import theme file"), new File(["{oops"], "broken.json"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This is not valid JSON");
  });
});

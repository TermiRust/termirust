import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = { settingsTerminalGet: vi.fn(), settingsTerminalSet: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { DEFAULT_TERMINAL_SETTINGS, resolveTerminalSettings, useSettingsStore } = await import("./settings-store");
const initial = useSettingsStore.getState();

describe("settings store", () => {
  beforeEach(() => {
    useSettingsStore.setState(initial, true);
    Object.values(commands).forEach((fn) => fn.mockReset());
  });

  it("loads saved terminal settings", async () => {
    commands.settingsTerminalGet.mockResolvedValue({ status: "ok", data: { ...DEFAULT_TERMINAL_SETTINGS, theme: "nord" } });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().terminal.theme).toBe("nord");
  });

  it("applies a change immediately and keeps the value the backend sanitised", async () => {
    let resolve: (v: unknown) => void = () => {};
    commands.settingsTerminalSet.mockReturnValue(new Promise((r) => (resolve = r)));
    const saving = useSettingsStore.getState().updateTerminal({ fontSize: 99 });
    expect(useSettingsStore.getState().terminal.fontSize).toBe(99);

    resolve({ status: "ok", data: { ...DEFAULT_TERMINAL_SETTINGS, fontSize: 32 } });
    await saving;
    expect(useSettingsStore.getState().terminal.fontSize).toBe(32);
    expect(commands.settingsTerminalSet).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 99 }));
  });

  it("copies the app theme aside on every load and save, for the next start-up", async () => {
    localStorage.clear();
    commands.settingsTerminalGet.mockResolvedValue({ status: "ok", data: { ...DEFAULT_TERMINAL_SETTINGS, appTheme: "tokyo-night" } });
    await useSettingsStore.getState().load();
    expect(JSON.parse(localStorage.getItem("termirust.theme") ?? "{}")).toMatchObject({ appTheme: "tokyo-night" });

    commands.settingsTerminalSet.mockResolvedValue({ status: "ok", data: { ...DEFAULT_TERMINAL_SETTINGS, appTheme: "light" } });
    await useSettingsStore.getState().updateTerminal({ appTheme: "light" });
    expect(JSON.parse(localStorage.getItem("termirust.theme") ?? "{}")).toMatchObject({ appTheme: "light" });
  });

  it("starts with the cached theme before the vault answers", async () => {
    localStorage.setItem("termirust.theme", JSON.stringify({ appTheme: "tokyo-night", customThemes: [] }));
    vi.resetModules();
    const fresh = await import("./settings-store");
    expect(fresh.useSettingsStore.getState().terminal.appTheme).toBe("tokyo-night");
    expect(fresh.useSettingsStore.getState().terminal.fontSize).toBe(DEFAULT_TERMINAL_SETTINGS.fontSize);
    localStorage.clear();
  });

  it("fills fields the backend left out or null with defaults", () => {
    expect(resolveTerminalSettings({ fontSize: 16, lineHeight: null })).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, fontSize: 16 });
  });

  it("keeps the error when saving fails", async () => {
    commands.settingsTerminalSet.mockResolvedValue({ status: "error", error: { code: "storage", message: "disk full" } });
    await useSettingsStore.getState().updateTerminal({ copyOnSelect: true });
    expect(useSettingsStore.getState().error).toBe("disk full");
  });
});

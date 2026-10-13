import { describe, expect, it } from "vitest";

import type { CustomTheme } from "@/bindings";

import { appThemeAttributes, appThemeChoices, applyAppTheme, effectiveTerminalTheme, luminance, mix, uiPalette } from "./app-theme";
import { terminalTheme } from "./terminal-theme";

const custom: CustomTheme = {
  id: "custom-paper",
  name: "Paper",
  background: "#fafafa",
  foreground: "#222222",
  cursor: "#000000",
  selection: "#cccccc",
  ansi: ["#000000", "#c00000", "#008000", "#806000", "#0040c0", "#800080", "#007070", "#cccccc", "#555555", "#ff0000", "#00a000", "#a08000", "#2060ff", "#a000a0", "#009090", "#ffffff"],
};

describe("app themes", () => {
  it("mixes and measures colours", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(luminance("#000000")).toBe(0);
  });

  it("derives a dark UI from Dracula with its purple accent", () => {
    const { dark, vars } = uiPalette(terminalTheme("dracula"));
    expect(dark).toBe(true);
    expect(vars["--bg"]).toBe("#282a36");
    expect(vars["--fg"]).toBe("#f8f8f2");
    expect(vars["--accent"]).toBe("#bd93f9");
    expect(luminance(vars["--sunk"] ?? "")).toBeLessThan(luminance("#282a36"));
  });

  it("derives a light UI from a light imported theme", () => {
    const attrs = appThemeAttributes("custom-paper", [custom]);
    expect(attrs.mode).toBe("light");
    expect(attrs.vars["--bg"]).toBe("#fafafa");
    expect(attrs.vars["--accent"]).toBe("#0040c0");
  });

  it("keeps the hand-tuned tokens for System, Light and Dark", () => {
    expect(appThemeAttributes("system")).toEqual({ mode: null, vars: {} });
    expect(appThemeAttributes("light")).toEqual({ mode: "light", vars: {} });
    expect(appThemeAttributes("dark")).toEqual({ mode: "dark", vars: {} });
  });

  it("lets the terminal follow the app, or keep its own theme", () => {
    expect(effectiveTerminalTheme("match-app", "tokyo-night")).toBe("tokyo-night");
    expect(effectiveTerminalTheme("match-app", "light")).toBe("termirust-dark");
    expect(effectiveTerminalTheme("nord", "dracula")).toBe("nord");
  });

  it("offers modes, built-in and imported themes", () => {
    const ids = appThemeChoices([custom]).map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual(["system", "light", "dark"]);
    expect(ids).toContain("dracula");
    expect(ids).toContain("tokyo-night");
    expect(ids.at(-1)).toBe("custom-paper");
  });

  it("applies and then clears theme variables on the root element", () => {
    const root = document.createElement("html");
    applyAppTheme(root, "dracula");
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.getPropertyValue("--accent")).toBe("#bd93f9");
    applyAppTheme(root, "system");
    expect(root.dataset.theme).toBeUndefined();
    expect(root.style.getPropertyValue("--accent")).toBe("");
  });
});

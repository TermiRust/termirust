import { beforeEach, describe, expect, it } from "vitest";

import { loadThemeCache, saveThemeCache } from "./theme-cache";

const custom = { id: "custom-nord", name: "Nord", background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selection: "#434c5e", ansi: Array(16).fill("#000000") };

describe("theme cache", () => {
  beforeEach(() => localStorage.clear());

  it("remembers the app theme so the first frame already uses it", () => {
    saveThemeCache({ appTheme: "custom-nord", customThemes: [custom] });
    expect(loadThemeCache()).toEqual({ appTheme: "custom-nord", customThemes: [custom] });
  });

  it("falls back to the system theme when nothing or something broken is stored", () => {
    expect(loadThemeCache()).toEqual({ appTheme: "system", customThemes: [] });
    localStorage.setItem("termirust.theme", "{not json");
    expect(loadThemeCache()).toEqual({ appTheme: "system", customThemes: [] });
    localStorage.setItem("termirust.theme", JSON.stringify({ appTheme: 42, customThemes: "x" }));
    expect(loadThemeCache()).toEqual({ appTheme: "system", customThemes: [] });
  });
});

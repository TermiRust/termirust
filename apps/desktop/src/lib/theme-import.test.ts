import { describe, expect, it } from "vitest";

import { mergeThemes, parseItermColors, parseThemeFile, parseWindowsTerminal } from "./theme-import";

const colourDict = (r: number, g: number, b: number) =>
  `<dict><key>Blue Component</key><real>${b}</real><key>Green Component</key><real>${g}</real><key>Red Component</key><real>${r}</real></dict>`;

function itermFile({ dropAnsi = false } = {}) {
  const ansi = Array.from({ length: dropAnsi ? 15 : 16 }, (_, i) => `<key>Ansi ${i} Color</key>${colourDict(i / 15, 0, 0)}`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${ansi}
    <key>Background Color</key>${colourDict(0, 0, 0)}
    <key>Foreground Color</key>${colourDict(1, 1, 1)}
    <key>Cursor Color</key>${colourDict(1, 0.5, 0)}
  </dict></plist>`;
}

const wtScheme = {
  name: "Campbell Plus",
  background: "#0C0C0C",
  foreground: "#CCCCCC",
  cursorColor: "#FFFFFF",
  selectionBackground: "#FFFFFF",
  black: "#0C0C0C", red: "#C50F1F", green: "#13A10E", yellow: "#C19C00", blue: "#0037DA", purple: "#881798", cyan: "#3A96DD", white: "#CCCCCC",
  brightBlack: "#767676", brightRed: "#E74856", brightGreen: "#16C60C", brightYellow: "#F9F1A5", brightBlue: "#3B78FF", brightPurple: "#B4009E", brightCyan: "#61D6D6", brightWhite: "#F2F2F2",
};

describe("theme import", () => {
  it("reads iTerm2 colours and names the theme after the file", () => {
    const theme = parseItermColors(itermFile(), "Monokai Pro.itermcolors");
    expect(theme).toMatchObject({ id: "custom-monokai-pro", name: "Monokai Pro", background: "#000000", foreground: "#ffffff", cursor: "#ff8000" });
    expect(theme.ansi).toHaveLength(16);
    expect(theme.ansi[15]).toBe("#ff0000");
    expect(theme.selection).toBe("#ffffff40");
  });

  it("rejects broken or incomplete iTerm2 files", () => {
    expect(() => parseItermColors("<plist><dict>", "x.itermcolors")).toThrow(/not a valid/);
    expect(() => parseItermColors(itermFile({ dropAnsi: true }), "x.itermcolors")).toThrow(/missing/);
  });

  it("reads one Windows Terminal scheme, a list, or the schemes of a settings.json", () => {
    expect(parseWindowsTerminal(JSON.stringify(wtScheme))[0]).toMatchObject({ id: "custom-campbell-plus", ansi: expect.arrayContaining(["#881798"]) });
    expect(parseWindowsTerminal(JSON.stringify({ profiles: {}, schemes: [wtScheme, { ...wtScheme, name: "Two" }] }))).toHaveLength(2);
    expect(() => parseWindowsTerminal("{nope")).toThrow("This is not valid JSON");
    expect(() => parseWindowsTerminal(JSON.stringify({ ...wtScheme, red: "red" }))).toThrow(/Campbell Plus/);
  });

  it("chooses the parser by file extension", () => {
    expect(parseThemeFile("a.json", JSON.stringify(wtScheme))).toHaveLength(1);
    expect(() => parseThemeFile("a.txt", "")).toThrow(/Choose an iTerm2/);
  });

  it("replaces a re-imported theme and renames clashing ids", () => {
    const first = parseWindowsTerminal(JSON.stringify(wtScheme));
    const updated = parseWindowsTerminal(JSON.stringify({ ...wtScheme, background: "#111111" }));
    const merged = mergeThemes(first, updated);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.background).toBe("#111111");

    const clash = { ...first[0]!, name: "Campbell+" };
    expect(mergeThemes(first, [clash]).map((t) => t.id)).toEqual(["custom-campbell-plus", "custom-campbell-plus-2"]);
  });
});

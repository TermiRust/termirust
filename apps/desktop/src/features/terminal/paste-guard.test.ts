import { describe, expect, it } from "vitest";

import { needsPasteConfirmation, pastedLineCount } from "./paste-guard";

describe("paste guard", () => {
  it.each([
    ["", 0],
    ["ls", 1],
    ["ls\n", 1],
    ["ls\npwd", 2],
    ["ls\r\npwd\r\n", 2],
    ["a\rb\rc", 3],
  ])("%j has %i lines", (text, lines) => {
    expect(pastedLineCount(text)).toBe(lines);
  });

  it("asks only for multi-line pastes and only when enabled", () => {
    expect(needsPasteConfirmation("rm -rf build\nmake", true)).toBe(true);
    expect(needsPasteConfirmation("rm -rf build\nmake", false)).toBe(false);
    expect(needsPasteConfirmation("echo hi\n", true)).toBe(false);
  });
});

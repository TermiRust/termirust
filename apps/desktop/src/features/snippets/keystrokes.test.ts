import { describe, expect, it } from "vitest";

import { canInsert, snippetKeystrokes } from "./keystrokes";

describe("snippet keystrokes", () => {
  it("presses Enter after every line when running", () => {
    expect(snippetKeystrokes("cd /srv\r\ngit pull", true)).toBe("cd /srv\rgit pull\r");
    expect(snippetKeystrokes("uptime", true)).toBe("uptime\r");
  });

  it("types without Enter when inserting", () => {
    expect(snippetKeystrokes("uptime", false)).toBe("uptime");
    expect(canInsert("uptime")).toBe(true);
    expect(canInsert("a\nb")).toBe(false);
  });
});

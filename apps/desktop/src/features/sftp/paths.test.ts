import { describe, expect, it } from "vitest";

import { baseName, joinPath, parentPath, pathStyleOf, validFileName } from "./paths";

describe("paths", () => {
  it("detects Windows homes", () => {
    expect(pathStyleOf("C:\\Users\\ace")).toBe("\\");
    expect(pathStyleOf("\\\\server\\share")).toBe("\\");
    expect(pathStyleOf("/Users/me")).toBe("/");
  });

  it("joins without doubling separators", () => {
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(joinPath("/var/log", "app.log")).toBe("/var/log/app.log");
    expect(joinPath("C:\\", "Users", "\\")).toBe("C:\\Users");
    expect(joinPath("C:\\Users", "ace", "\\")).toBe("C:\\Users\\ace");
  });

  it("walks up to the root and stops there", () => {
    expect(parentPath("/var/log")).toBe("/var");
    expect(parentPath("/var/log/")).toBe("/var");
    expect(parentPath("/var")).toBe("/");
    expect(parentPath("/")).toBe("/");
    expect(parentPath("C:\\Users\\ace", "\\")).toBe("C:\\Users");
    expect(parentPath("C:\\Users", "\\")).toBe("C:\\");
    expect(parentPath("C:\\", "\\")).toBe("C:\\");
  });

  it("takes the last path component", () => {
    expect(baseName("/var/log/app.log")).toBe("app.log");
    expect(baseName("/srv/site/")).toBe("site");
    expect(baseName("/")).toBe("/");
    expect(baseName("C:\\Users\\ace", "\\")).toBe("ace");
  });

  it("validates new names", () => {
    expect(validFileName("  ")).toBe("Name is required");
    expect(validFileName("..")).toBe("That name is reserved");
    expect(validFileName("a/b")).toMatch(/cannot contain/);
    expect(validFileName("a\\b")).toMatch(/cannot contain/);
    expect(validFileName("notes.txt")).toBeNull();
  });
});

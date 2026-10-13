import { describe, expect, it } from "vitest";

import { formatBytes, formatModified, formatPermissions } from "./format";

describe("format", () => {
  it("formats byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  it("formats modification times and tolerates missing ones", () => {
    expect(formatModified(null)).toBe("");
    expect(formatModified(1_700_000_000, "en-GB")).toMatch(/2023/);
  });

  it("formats permission bits", () => {
    expect(formatPermissions(0o755)).toBe("rwxr-xr-x");
    expect(formatPermissions(0o640)).toBe("rw-r-----");
    expect(formatPermissions(null)).toBe("");
  });
});

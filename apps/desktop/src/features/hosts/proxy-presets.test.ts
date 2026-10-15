import { describe, expect, it } from "vitest";

import { PROXY_PRESETS, fillRange } from "./proxy-presets";

describe("proxy presets", () => {
  it("offers Cloudflare Tunnel ready to use", () => {
    const cloudflare = PROXY_PRESETS.find((p) => p.label === "Cloudflare Tunnel");
    expect(cloudflare?.command).toBe("cloudflared access ssh --hostname %h");
    expect(cloudflare && fillRange(cloudflare)).toBeNull();
  });

  it("points at the part still to replace", () => {
    for (const preset of PROXY_PRESETS.filter((p) => p.fill)) {
      const range = fillRange(preset);
      expect(range && preset.command.slice(...range)).toBe(preset.fill);
    }
  });

  it("only uses the OpenSSH tokens the app expands", () => {
    for (const preset of PROXY_PRESETS) expect(preset.command.replace(/%[hpr%]/g, "")).not.toMatch(/%/);
  });
});

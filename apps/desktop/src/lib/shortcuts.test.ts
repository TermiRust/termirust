import { describe, expect, it } from "vitest";

import { isMacPlatform, isToggleSidebarShortcut, toggleSidebarLabel, type KeyChord } from "./shortcuts";

const chord = (overrides: Partial<KeyChord>): KeyChord => ({
  key: "b",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe("isToggleSidebarShortcut", () => {
  it.each([
    ["⌘B on macOS", chord({ metaKey: true }), true, true],
    ["⌘B with uppercase key on macOS", chord({ key: "B", metaKey: true }), true, true],
    ["Ctrl+B on macOS is left to the shell", chord({ ctrlKey: true }), true, false],
    ["⌘⇧B on macOS", chord({ metaKey: true, shiftKey: true }), true, false],
    ["⌘⌃B on macOS", chord({ metaKey: true, ctrlKey: true }), true, false],
    ["Ctrl+Shift+B on Windows/Linux", chord({ ctrlKey: true, shiftKey: true }), false, true],
    ["Ctrl+B on Windows/Linux is left to the shell", chord({ ctrlKey: true }), false, false],
    ["Meta+Ctrl+Shift+B on Windows/Linux", chord({ metaKey: true, ctrlKey: true, shiftKey: true }), false, false],
    ["Alt modifier is never the shortcut", chord({ metaKey: true, altKey: true }), true, false],
    ["other keys are ignored", chord({ key: "k", metaKey: true }), true, false],
  ])("%s", (_name, event, onMac, expected) => {
    expect(isToggleSidebarShortcut(event, onMac)).toBe(expected);
  });
});

describe("isMacPlatform", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", true],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", true],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false],
    ["Mozilla/5.0 (X11; Linux x86_64)", false],
  ])("%s → %s", (ua, expected) => {
    expect(isMacPlatform(ua)).toBe(expected);
  });
});

describe("toggleSidebarLabel", () => {
  it("shows the platform-specific chord", () => {
    expect(toggleSidebarLabel(true)).toBe("⌘B");
    expect(toggleSidebarLabel(false)).toBe("Ctrl+Shift+B");
  });
});

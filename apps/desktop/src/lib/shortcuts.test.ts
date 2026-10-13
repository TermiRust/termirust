import { describe, expect, it } from "vitest";

import { aiShortcutLabel, appShortcut, isAiShortcut, isAppChord, paneShortcut, isFindShortcut, isMacPlatform, isToggleSidebarShortcut, shortcutLabel, tabShortcut, toggleSidebarLabel, type KeyChord } from "./shortcuts";

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

describe("tabShortcut", () => {
  it.each([
    ["⌘W closes on macOS", chord({ key: "w", metaKey: true }), true, { action: "close" }],
    ["Ctrl+W is left to the shell on macOS", chord({ key: "w", ctrlKey: true }), true, null],
    ["Ctrl+Shift+W closes on Windows/Linux", chord({ key: "W", ctrlKey: true, shiftKey: true }), false, { action: "close" }],
    ["Ctrl+W is left to the shell on Windows/Linux", chord({ key: "w", ctrlKey: true }), false, null],
    ["⌘T opens a local terminal on macOS", chord({ key: "t", metaKey: true }), true, { action: "newLocal" }],
    ["Ctrl+Shift+T opens a local terminal on Windows/Linux", chord({ key: "T", ctrlKey: true, shiftKey: true }), false, { action: "newLocal" }],
    ["Ctrl+T is left to the shell on Windows/Linux", chord({ key: "t", ctrlKey: true }), false, null],
    ["⌘3 selects the third tab", chord({ key: "3", metaKey: true }), true, { action: "select", index: 2 }],
    ["Alt+1 selects the first tab on Windows/Linux", chord({ key: "1", altKey: true }), false, { action: "select", index: 0 }],
    ["Ctrl+1 is left to the shell on Windows/Linux", chord({ key: "1", ctrlKey: true }), false, null],
    ["⌘⇧3 is not a tab shortcut", chord({ key: "3", metaKey: true, shiftKey: true }), true, null],
    ["0 is not a tab", chord({ key: "0", metaKey: true }), true, null],
    ["other keys are ignored", chord({ key: "k", metaKey: true }), true, null],
  ])("%s", (_name, event, onMac, expected) => {
    expect(tabShortcut(event, onMac)).toEqual(expected);
  });
});

describe("appShortcut", () => {
  it.each([
    ["⌘K opens the palette on macOS", chord({ key: "k", metaKey: true }), true, "palette"],
    ["⌘N adds a host on macOS", chord({ key: "n", metaKey: true }), true, "newHost"],
    ["Ctrl+Shift+K opens the palette elsewhere", chord({ key: "K", ctrlKey: true, shiftKey: true }), false, "palette"],
    ["Ctrl+K is left to the shell elsewhere", chord({ key: "k", ctrlKey: true }), false, null],
    ["Ctrl+K is left to the shell on macOS", chord({ key: "k", ctrlKey: true }), true, null],
    ["other keys are ignored", chord({ key: "j", metaKey: true }), true, null],
  ])("%s", (_name, event, onMac, expected) => {
    expect(appShortcut(event, onMac)).toBe(expected);
  });

  it("labels shortcuts per platform", () => {
    expect(shortcutLabel("palette", true)).toBe("⌘K");
    expect(shortcutLabel("newLocal", false)).toBe("Ctrl+Shift+T");
  });
});

describe("isFindShortcut", () => {
  it.each([
    [chord({ key: "f", metaKey: true }), true, true],
    [chord({ key: "f", ctrlKey: true }), true, false],
    [chord({ key: "F", ctrlKey: true, shiftKey: true }), false, true],
    [chord({ key: "f", ctrlKey: true }), false, false],
    [chord({ key: "f", metaKey: true, altKey: true }), true, false],
    [chord({ key: "g", metaKey: true }), true, false],
  ])("%j on mac=%s → %s", (event, onMac, expected) => {
    expect(isFindShortcut(event, onMac)).toBe(expected);
  });
});

describe("isAiShortcut", () => {
  const chord = (key: string, mods: Partial<KeyChord> = {}): KeyChord => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

  it("uses ⌘I on macOS and never steals Ctrl+I (Tab) elsewhere", () => {
    expect(isAiShortcut(chord("i", { metaKey: true }), true)).toBe(true);
    expect(isAiShortcut(chord("I", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isAiShortcut(chord("i", { ctrlKey: true }), false)).toBe(false);
    expect(isAiShortcut(chord("i", { ctrlKey: true }), true)).toBe(false);
    expect(isAiShortcut(chord("i", { metaKey: true, altKey: true }), true)).toBe(false);
    expect(aiShortcutLabel(true)).toBe("⌘I");
    expect(aiShortcutLabel(false)).toBe("Ctrl+Shift+I");
  });
});

describe("paneShortcut", () => {
  const chord = (key: string, mods: Partial<KeyChord> = {}): KeyChord => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

  it("splits and moves focus with the macOS chords", () => {
    expect(paneShortcut(chord("d", { metaKey: true }), true)).toEqual({ action: "split", direction: "row" });
    expect(paneShortcut(chord("D", { metaKey: true, shiftKey: true }), true)).toEqual({ action: "split", direction: "column" });
    expect(paneShortcut(chord("ArrowLeft", { metaKey: true, altKey: true }), true)).toEqual({ action: "focus", direction: "left" });
    expect(paneShortcut(chord("ArrowLeft", { metaKey: true }), true)).toBeNull();
    expect(paneShortcut(chord("d", { ctrlKey: true }), true)).toBeNull();
  });

  it("uses Ctrl+Shift and Ctrl+Alt on Windows and Linux, leaving Ctrl+D (EOF) to the shell", () => {
    expect(paneShortcut(chord("D", { ctrlKey: true, shiftKey: true }), false)).toEqual({ action: "split", direction: "row" });
    expect(paneShortcut(chord("E", { ctrlKey: true, shiftKey: true }), false)).toEqual({ action: "split", direction: "column" });
    expect(paneShortcut(chord("ArrowDown", { ctrlKey: true, altKey: true }), false)).toEqual({ action: "focus", direction: "down" });
    expect(paneShortcut(chord("d", { ctrlKey: true }), false)).toBeNull();
    expect(isAppChord(chord("d", { ctrlKey: true }), false)).toBe(false);
    expect(isAppChord(chord("D", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(isAppChord(chord("t", { metaKey: true }), true)).toBe(true);
  });
});

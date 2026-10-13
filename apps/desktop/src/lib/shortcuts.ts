export interface KeyChord {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function isMacPlatform(platform: string = navigator.userAgent): boolean {
  return /Mac|iPhone|iPad/i.test(platform);
}

// Windows/Linux shortcuts add Shift so that Ctrl+B etc. still reach the remote shell.
export function isToggleSidebarShortcut(event: KeyChord, onMac: boolean): boolean {
  if (event.key.toLowerCase() !== "b" || event.altKey) return false;
  return onMac
    ? event.metaKey && !event.ctrlKey && !event.shiftKey
    : event.ctrlKey && event.shiftKey && !event.metaKey;
}

export function toggleSidebarLabel(onMac: boolean): string {
  return onMac ? "⌘B" : "Ctrl+Shift+B";
}

export type TabShortcut = { action: "close" } | { action: "newLocal" } | { action: "select"; index: number } | null;

/** ⌘T / ⌘W / ⌘1–9 on macOS; Ctrl+Shift+T / Ctrl+Shift+W / Alt+1–9 elsewhere so Ctrl+T/W reach the shell. */
export function tabShortcut(event: KeyChord, onMac: boolean): TabShortcut {
  const key = event.key.toLowerCase();
  if (key === "w" || key === "t") {
    const matches = onMac
      ? event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
    if (!matches) return null;
    return key === "w" ? { action: "close" } : { action: "newLocal" };
  }
  if (/^[1-9]$/.test(key)) {
    const select = onMac
      ? event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      : event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey;
    return select ? { action: "select", index: Number(key) - 1 } : null;
  }
  return null;
}

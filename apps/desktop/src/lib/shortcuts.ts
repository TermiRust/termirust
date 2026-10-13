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

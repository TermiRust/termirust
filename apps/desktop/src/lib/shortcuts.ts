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

export type AppShortcut = "palette" | "newHost" | null;

/** ⌘K / ⌘N on macOS; Ctrl+Shift+K / Ctrl+Shift+N elsewhere (Ctrl+K kills the line in shells). */
export function appShortcut(event: KeyChord, onMac: boolean): AppShortcut {
  const key = event.key.toLowerCase();
  if (key !== "k" && key !== "n") return null;
  const matches = onMac
    ? event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
  if (!matches) return null;
  return key === "k" ? "palette" : "newHost";
}

export function shortcutLabel(action: "palette" | "newHost" | "newLocal" | "sidebar", onMac: boolean): string {
  const mac = { palette: "⌘K", newHost: "⌘N", newLocal: "⌘T", sidebar: "⌘B" };
  const other = { palette: "Ctrl+Shift+K", newHost: "Ctrl+Shift+N", newLocal: "Ctrl+Shift+T", sidebar: "Ctrl+Shift+B" };
  return (onMac ? mac : other)[action];
}

/** ⌘F on macOS; Ctrl+Shift+F elsewhere so Ctrl+F (forward a char) still reaches the shell. */
export function isFindShortcut(event: KeyChord, onMac: boolean): boolean {
  if (event.key.toLowerCase() !== "f" || event.altKey) return false;
  return onMac ? event.metaKey && !event.ctrlKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey;
}

/** ⌘I on macOS; Ctrl+Shift+I elsewhere, because Ctrl+I is Tab inside a terminal. */
export function isAiShortcut(event: KeyChord, onMac: boolean): boolean {
  if (event.key.toLowerCase() !== "i" || event.altKey) return false;
  return onMac ? event.metaKey && !event.ctrlKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey;
}

export function aiShortcutLabel(onMac: boolean): string {
  return onMac ? "⌘I" : "Ctrl+Shift+I";
}

export type PaneShortcut = { action: "split"; direction: "row" | "column" } | { action: "focus"; direction: "left" | "right" | "up" | "down" } | null;

const ARROWS: Record<string, "left" | "right" | "up" | "down"> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/** ⌘D / ⌘⇧D and ⌘⌥+arrows on macOS; Ctrl+Shift+D / Ctrl+Shift+E and Ctrl+Alt+arrows elsewhere (ADR-015). */
export function paneShortcut(event: KeyChord, onMac: boolean): PaneShortcut {
  const arrow = ARROWS[event.key];
  if (arrow) {
    const focus = onMac ? event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey : event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;
    return focus ? { action: "focus", direction: arrow } : null;
  }
  const key = event.key.toLowerCase();
  if (event.altKey) return null;
  if (onMac) {
    if (!event.metaKey || event.ctrlKey || key !== "d") return null;
    return { action: "split", direction: event.shiftKey ? "column" : "row" };
  }
  if (!event.ctrlKey || !event.shiftKey || event.metaKey) return null;
  if (key === "d") return { action: "split", direction: "row" };
  if (key === "e") return { action: "split", direction: "column" };
  return null;
}

/** App chords the terminal must not also interpret (e.g. Ctrl+Shift+D would otherwise send EOF). */
export function isAppChord(event: KeyChord, onMac: boolean): boolean {
  return paneShortcut(event, onMac) !== null || tabShortcut(event, onMac) !== null || appShortcut(event, onMac) !== null || isToggleSidebarShortcut(event, onMac);
}

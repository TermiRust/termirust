/**
 * The webview's own context menu offers Reload (and Inspect), and F5 / ⌘R / Ctrl+R reload too.
 * A reload drops every open tab and SSH session, so both are blocked; editable fields keep
 * their Cut/Copy/Paste menu. Reload stays available in development.
 */
export function installWebviewGuards(target: Window = window, options: { dev?: boolean } = {}): () => void {
  const onContextMenu = (event: MouseEvent) => {
    // Our own menus already took this right-click.
    if (event.defaultPrevented) return;
    if (isEditable(event.target)) return;
    event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (options.dev) return;
    if (isReloadKey(event)) event.preventDefault();
  };
  target.addEventListener("contextmenu", onContextMenu);
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
    target.removeEventListener("keydown", onKeyDown);
  };
}

/** F5, ⌘R / Ctrl+R and their Shift variants. In a focused terminal Ctrl+R still reaches the shell. */
export function isReloadKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">): boolean {
  if (event.key === "F5") return true;
  return event.key.toLowerCase() === "r" && (event.metaKey || event.ctrlKey);
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // xterm's hidden textarea is not a field the user sees; the terminal has its own menu.
  if (target.classList.contains("xterm-helper-textarea")) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
}

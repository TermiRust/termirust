/** Lets features outside a terminal tab (snippets, multi-host runs) type into its session. */
type Send = (text: string) => void;

const inputs = new Map<string, Send>();
/** Text waiting for a tab that has not connected yet (e.g. a multi-host snippet run). */
const pending = new Map<string, string>();

/** Registers while the tab's session can take input; call the result to unregister. */
export function registerTerminalInput(tabId: string, send: Send): () => void {
  inputs.set(tabId, send);
  const queued = pending.get(tabId);
  if (queued !== undefined) {
    pending.delete(tabId);
    send(queued);
  }
  return () => {
    if (inputs.get(tabId) === send) inputs.delete(tabId);
  };
}

export function canSendToTerminal(tabId: string | null | undefined): boolean {
  return tabId != null && inputs.has(tabId);
}

/** False when the tab is gone or not connected. */
export function sendToTerminal(tabId: string, text: string): boolean {
  const send = inputs.get(tabId);
  if (!send) return false;
  send(text);
  return true;
}

/** Sends now if the tab is connected, otherwise as soon as it connects. */
export function sendWhenReady(tabId: string, text: string): void {
  if (!sendToTerminal(tabId, text)) pending.set(tabId, (pending.get(tabId) ?? "") + text);
}

/** Drops queued text for a tab that was closed before it connected. */
export function forgetPendingInput(tabId: string): void {
  pending.delete(tabId);
}

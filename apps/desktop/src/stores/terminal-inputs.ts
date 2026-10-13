/** Lets features outside a terminal tab (snippets, multi-host runs) type into its session. */
type Send = (text: string) => void;

const inputs = new Map<string, Send>();

/** Registers while the tab's session can take input; call the result to unregister. */
export function registerTerminalInput(tabId: string, send: Send): () => void {
  inputs.set(tabId, send);
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

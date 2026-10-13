/** Number of lines a paste would execute, ignoring a single trailing newline. */
export function pastedLineCount(text: string): number {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  return normalized === "" ? 0 : normalized.split("\n").length;
}

/** Multi-line pastes run several commands at once, so ask first when the user wants that. */
export function needsPasteConfirmation(text: string, enabled: boolean): boolean {
  return enabled && pastedLineCount(text) > 1;
}

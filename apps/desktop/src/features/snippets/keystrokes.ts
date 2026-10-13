/** What to type for a snippet. Running presses Enter after each line; inserting types one line and stops. */
export function snippetKeystrokes(command: string, run: boolean): string {
  const lines = command.replace(/\r\n?/g, "\n").split("\n");
  return run ? lines.map((line) => `${line}\r`).join("") : (lines[0] ?? "");
}

/** Inserting a multi-line command would run every line but the last, so only running is offered. */
export const canInsert = (command: string) => !/[\r\n]/.test(command);

export interface SnippetVariable {
  name: string;
  defaultValue: string;
}

// {{name}} or {{name:default}}; spaces inside the braces are allowed.
const VARIABLE = /\{\{\s*([A-Za-z_][\w-]*)\s*(?::((?:(?!\}\}).)*))?\}\}/g;

/** Variables in order of first appearance; the first default given for a name wins. */
export function parseVariables(command: string): SnippetVariable[] {
  const found = new Map<string, string>();
  for (const match of command.matchAll(VARIABLE)) {
    const name = match[1] ?? "";
    if (!found.has(name)) found.set(name, (match[2] ?? "").trim());
  }
  return [...found].map(([name, defaultValue]) => ({ name, defaultValue }));
}

/** Replaces every occurrence; a blank value falls back to that occurrence's default. */
export function fillVariables(command: string, values: Record<string, string>): string {
  return command.replace(VARIABLE, (_whole, name: string, fallback: string | undefined) => {
    const value = values[name];
    return value !== undefined && value !== "" ? value : (fallback ?? "").trim();
  });
}

import type { CustomTheme } from "@/bindings";

const ANSI_NAMES = ["black", "red", "green", "yellow", "blue", "purple", "cyan", "white"];
const WT_ANSI = [...ANSI_NAMES, ...ANSI_NAMES.map((n) => `bright${n[0]?.toUpperCase()}${n.slice(1)}`)];

const hex = (n: number) =>
  Math.round(Math.min(1, Math.max(0, n)) * 255)
    .toString(16)
    .padStart(2, "0");
const isHex = (v: unknown): v is string => typeof v === "string" && /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `custom-${base || "theme"}`;
}

/** Theme name from a file name like "Monokai Pro.itermcolors". */
const nameFromFile = (fileName: string) => fileName.replace(/\.[^.]+$/, "").trim() || "Imported theme";

/** iTerm2 .itermcolors: an XML plist of colour dicts with 0–1 RGB components. */
export function parseItermColors(xml: string, fileName: string): CustomTheme {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("This is not a valid .itermcolors file");
  const root = doc.querySelector("plist > dict");
  if (!root) throw new Error("This is not a valid .itermcolors file");
  const colours = new Map<string, string>();
  const children = Array.from(root.children);
  children.forEach((node, i) => {
    const value = children[i + 1];
    if (node.tagName !== "key" || value?.tagName !== "dict") return;
    const parts = Array.from(value.children);
    const component = (label: string) => {
      const index = parts.findIndex((p) => p.tagName === "key" && p.textContent === `${label} Component`);
      return Number(parts[index + 1]?.textContent ?? NaN);
    };
    const [r, g, b] = [component("Red"), component("Green"), component("Blue")];
    if ([r, g, b].every(Number.isFinite)) colours.set(node.textContent ?? "", `#${hex(r)}${hex(g)}${hex(b)}`);
  });
  const ansi = Array.from({ length: 16 }, (_, i) => colours.get(`Ansi ${i} Color`));
  const background = colours.get("Background Color");
  const foreground = colours.get("Foreground Color");
  if (!background || !foreground || ansi.some((c) => !c)) throw new Error("The file is missing some of the 16 ANSI colours or the background/foreground");
  const name = nameFromFile(fileName);
  return {
    id: slug(name),
    name,
    background,
    foreground,
    cursor: colours.get("Cursor Color") ?? foreground,
    selection: colours.get("Selection Color") ?? `${foreground}40`,
    ansi: ansi as string[],
  };
}

function fromWindowsScheme(scheme: Record<string, unknown>): CustomTheme {
  const name = typeof scheme.name === "string" && scheme.name.trim() ? scheme.name.trim() : "Imported theme";
  const ansi = WT_ANSI.map((key) => scheme[key]);
  if (!isHex(scheme.background) || !isHex(scheme.foreground) || !ansi.every(isHex)) {
    throw new Error(`The scheme "${name}" is missing colours or uses an unsupported format`);
  }
  return {
    id: slug(name),
    name,
    background: scheme.background,
    foreground: scheme.foreground,
    cursor: isHex(scheme.cursorColor) ? scheme.cursorColor : scheme.foreground,
    selection: isHex(scheme.selectionBackground) ? scheme.selectionBackground : `${scheme.foreground}40`,
    ansi: ansi as string[],
  };
}

/** A Windows Terminal scheme object, an array of them, or a settings.json with "schemes". */
export function parseWindowsTerminal(json: string): CustomTheme[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("This is not valid JSON");
  }
  const schemes = Array.isArray(data) ? data : data && typeof data === "object" && "schemes" in data ? (data as { schemes: unknown }).schemes : [data];
  if (!Array.isArray(schemes) || schemes.length === 0) throw new Error("No colour scheme found in this file");
  return schemes.map((s) => fromWindowsScheme((s ?? {}) as Record<string, unknown>));
}

/** Picks the parser from the file name. */
export function parseThemeFile(fileName: string, text: string): CustomTheme[] {
  if (/\.itermcolors$/i.test(fileName)) return [parseItermColors(text, fileName)];
  if (/\.json$/i.test(fileName)) return parseWindowsTerminal(text);
  throw new Error("Choose an iTerm2 .itermcolors file or a Windows Terminal .json scheme");
}

/** Adds imported themes, renaming ids that clash and replacing a theme imported again under the same name. */
export function mergeThemes(existing: CustomTheme[], imported: CustomTheme[]): CustomTheme[] {
  const result = [...existing];
  for (const theme of imported) {
    const sameName = result.findIndex((t) => t.name === theme.name);
    if (sameName >= 0) {
      result[sameName] = { ...theme, id: result[sameName]?.id ?? theme.id };
      continue;
    }
    let id = theme.id;
    for (let n = 2; result.some((t) => t.id === id); n++) id = `${theme.id}-${n}`;
    result.push({ ...theme, id });
  }
  return result;
}

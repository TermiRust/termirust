import type { CustomTheme } from "@/bindings";

import { allThemes, type TerminalTheme } from "./terminal-theme";

export const MATCH_APP = "match-app";
/** Appearances that use the hand-tuned Termirust tokens in index.css. */
export const APP_MODES = ["system", "light", "dark"] as const;
type AppMode = (typeof APP_MODES)[number];

const isMode = (id: string): id is AppMode => (APP_MODES as readonly string[]).includes(id);

/** Accents picked by hand where a theme has a well-known signature colour. */
const ACCENTS: Record<string, string> = {
  dracula: "#bd93f9",
  "tokyo-night": "#7aa2f7",
  "solarized-dark": "#268bd2",
  nord: "#88c0d0",
  "gruvbox-dark": "#fe8019",
};

type Rgb = [number, number, number];

function parse(color: string): Rgb {
  const hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  const rgb = /rgba?\(([^)]+)\)/i.exec(color)?.[1]?.split(",").map((n) => Number(n.trim()));
  return rgb && rgb.length >= 3 ? [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0] : [0, 0, 0];
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")).join("")}`;

/** `a` moved towards `b` by `amount` (0–1). */
export function mix(a: string, b: string, amount: number): string {
  const x = parse(a);
  const y = parse(b);
  return hex([0, 1, 2].map((i) => (x[i] ?? 0) + ((y[i] ?? 0) - (x[i] ?? 0)) * amount) as Rgb);
}

const alpha = (color: string, a: number) => {
  const [r, g, b] = parse(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Relative luminance (WCAG), 0 = black, 1 = white. */
export function luminance(color: string): number {
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parse(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** CSS variables for the whole UI, derived from a terminal theme's colours. */
export function uiPalette(theme: TerminalTheme): { vars: Record<string, string>; dark: boolean } {
  const c = theme.colors;
  const bg = c.background ?? "#15130f";
  const fg = c.foreground ?? "#ece8e1";
  const dark = luminance(bg) < 0.4;
  const shade = dark ? "#000000" : "#ffffff";
  const accent = ACCENTS[theme.id] ?? c.blue ?? "#fb923c";
  const green = (dark ? c.brightGreen : c.green) ?? "#7fd69c";
  const yellow = (dark ? c.brightYellow : c.yellow) ?? "#fbbf24";
  const red = (dark ? c.brightRed : c.red) ?? "#f87171";
  return {
    dark,
    vars: {
      "--page": mix(bg, shade, 0.22),
      "--bg": bg,
      "--elev": mix(bg, fg, 0.05),
      "--sunk": mix(bg, shade, 0.12),
      "--sunk2": mix(bg, fg, 0.09),
      "--fg": fg,
      "--fg2": mix(fg, bg, 0.15),
      "--muted": mix(fg, bg, 0.4),
      "--faint": mix(fg, bg, 0.58),
      "--border": mix(bg, fg, 0.13),
      "--border2": mix(bg, fg, 0.2),
      "--hover": alpha(fg, 0.06),
      "--active": alpha(fg, 0.1),
      "--accent": accent,
      "--accent-fg": luminance(accent) > 0.35 ? mix(bg, "#000000", dark ? 0.2 : 0.8) : "#ffffff",
      "--accent-soft": mix(bg, accent, 0.18),
      "--accent-ring": alpha(accent, 0.38),
      "--ok": green,
      "--ok-soft": mix(bg, green, 0.15),
      "--warn": yellow,
      "--warn-soft": mix(bg, yellow, 0.15),
      "--danger": red,
      "--danger-soft": mix(bg, red, 0.14),
      "--danger-border": mix(bg, red, 0.4),
      "--scrim": dark ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0.3)",
      "--tab-red": red,
      "--tab-amber": yellow,
      "--tab-teal": c.cyan ?? "#2dd4bf",
      "--tab-blue": c.blue ?? "#60a5fa",
      "--tab-violet": c.magenta ?? "#a78bfa",
    },
  };
}

export const PALETTE_VARS = Object.keys(uiPalette({ id: "x", name: "x", colors: {} }).vars);

/** Choices for the Appearance setting: the three modes, then every colour theme. */
export function appThemeChoices(custom: CustomTheme[] = []): { id: string; name: string }[] {
  return [
    { id: "system", name: "System" },
    { id: "light", name: "Light" },
    { id: "dark", name: "Dark" },
    ...allThemes(custom)
      .filter((t) => t.id !== "termirust-dark")
      .map((t) => ({ id: t.id, name: t.name })),
  ];
}

/** The terminal theme in effect: its own choice, or the app's theme when it follows the app. */
export function effectiveTerminalTheme(terminalTheme: string, appTheme: string): string {
  if (terminalTheme !== MATCH_APP) return terminalTheme;
  // The Termirust modes keep the dark terminal from the mockup, even in light mode.
  return isMode(appTheme) ? "termirust-dark" : appTheme;
}

/** What to put on <html>: a data-theme mode and, for colour themes, inline variables. */
export function appThemeAttributes(appTheme: string, custom: CustomTheme[] = []): { mode: "light" | "dark" | null; vars: Record<string, string> } {
  if (appTheme === "system") return { mode: null, vars: {} };
  if (appTheme === "light" || appTheme === "dark") return { mode: appTheme, vars: {} };
  const theme = allThemes(custom).find((t) => t.id === appTheme);
  if (!theme) return { mode: null, vars: {} };
  const palette = uiPalette(theme);
  return { mode: palette.dark ? "dark" : "light", vars: palette.vars };
}

/** Applies the appearance to the document root, clearing variables of the previous theme. */
export function applyAppTheme(root: HTMLElement, appTheme: string, custom: CustomTheme[] = []): void {
  const { mode, vars } = appThemeAttributes(appTheme, custom);
  if (mode) root.dataset.theme = mode;
  else delete root.dataset.theme;
  for (const name of PALETTE_VARS) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

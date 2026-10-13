import type { ITheme } from "@xterm/xterm";

export interface TerminalTheme {
  id: string;
  name: string;
  colors: ITheme;
}

const ansi = (c: string[]) => ({
  black: c[0], red: c[1], green: c[2], yellow: c[3], blue: c[4], magenta: c[5], cyan: c[6], white: c[7],
  brightBlack: c[8], brightRed: c[9], brightGreen: c[10], brightYellow: c[11], brightBlue: c[12], brightMagenta: c[13], brightCyan: c[14], brightWhite: c[15],
});

/** "Termirust Dark" from the mockup; the terminal surface stays dark in both app themes. */
export const termirustDark: ITheme = {
  background: "#100e0b",
  foreground: "#e6e1d8",
  cursor: "#fb923c",
  cursorAccent: "#100e0b",
  selectionBackground: "rgba(251, 146, 60, 0.25)",
  ...ansi(["#1d1a16", "#f2777a", "#9fd17f", "#f0c674", "#82b4ea", "#c99de0", "#7fd0c6", "#e6e1d8", "#8a8478", "#ff9a9c", "#b9e39d", "#f6d792", "#a3c9f2", "#dcbaec", "#a2e0d8", "#ffffff"]),
};

export const TERMINAL_THEMES: TerminalTheme[] = [
  { id: "termirust-dark", name: "Termirust Dark", colors: termirustDark },
  {
    id: "dracula",
    name: "Dracula",
    colors: {
      background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", selectionBackground: "rgba(68, 71, 90, 0.8)",
      ...ansi(["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2", "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff"]),
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    colors: {
      background: "#002b36", foreground: "#839496", cursor: "#93a1a1", selectionBackground: "rgba(7, 54, 66, 0.9)",
      ...ansi(["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"]),
    },
  },
  {
    id: "nord",
    name: "Nord",
    colors: {
      background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selectionBackground: "rgba(67, 76, 94, 0.9)",
      ...ansi(["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0", "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4"]),
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    colors: {
      background: "#282828", foreground: "#ebdbb2", cursor: "#ebdbb2", selectionBackground: "rgba(80, 73, 69, 0.9)",
      ...ansi(["#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984", "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2"]),
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    colors: {
      background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5", selectionBackground: "rgba(40, 52, 87, 0.9)",
      ...ansi(["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6", "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"]),
    },
  },
];

const FALLBACK_THEME: TerminalTheme = { id: "termirust-dark", name: "Termirust Dark", colors: termirustDark };

export function terminalTheme(id: string): TerminalTheme {
  return TERMINAL_THEMES.find((t) => t.id === id) ?? FALLBACK_THEME;
}

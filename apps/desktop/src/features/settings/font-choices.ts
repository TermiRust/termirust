/** Fonts offered in Settings, each with fallbacks for machines that lack it. */
export const FONT_CHOICES: { label: string; stack: string }[] = [
  { label: "JetBrains Mono", stack: '"JetBrains Mono", Menlo, Consolas, monospace' },
  { label: "SF Mono", stack: '"SF Mono", Menlo, monospace' },
  { label: "Menlo", stack: "Menlo, monospace" },
  { label: "Fira Code", stack: '"Fira Code", Menlo, Consolas, monospace' },
  { label: "Cascadia Code", stack: '"Cascadia Code", Consolas, monospace' },
  { label: "Consolas", stack: "Consolas, monospace" },
  { label: "System monospace", stack: "monospace" },
];

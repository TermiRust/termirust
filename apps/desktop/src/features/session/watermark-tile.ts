/** A tile of tilted words, repeated over the whole terminal so output can never hide it all. */
export function watermarkTile(word: string, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150">` +
    `<text x="120" y="80" text-anchor="middle" dominant-baseline="middle" transform="rotate(-20 120 75)" ` +
    `font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="40" font-weight="900" letter-spacing="4" fill="${color}">${word}</text>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

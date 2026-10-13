export interface FuzzyMatch {
  score: number;
  /** Indices in the text of the matched characters, for highlighting. */
  indices: number[];
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_.@/:]/.test(text[i - 1] ?? "");

/**
 * Subsequence match, case-insensitive. Consecutive characters and matches at word starts
 * score higher, so "pdb" ranks "prod-db" above "pandabear".
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let previous = -2;

  for (const ch of q) {
    if (ch === " ") continue;
    const found = nextMatch(t, text, ch, from);
    if (found === -1) return null;
    score += 1;
    if (found === previous + 1) score += 3;
    if (isBoundary(text, found)) score += 2;
    indices.push(found);
    previous = found;
    from = found + 1;
  }
  score -= text.length * 0.01;
  if (t.startsWith(q)) score += 5;
  return { score, indices };
}

/** The next position of `ch`: right here if adjacent, else at a word start, else anywhere. */
function nextMatch(lower: string, original: string, ch: string, from: number): number {
  if (lower[from] === ch) return from;
  let first = -1;
  for (let i = from; i < lower.length; i++) {
    if (lower[i] !== ch) continue;
    if (isBoundary(original, i)) return i;
    if (first === -1) first = i;
  }
  return first;
}

export function rankByFuzzy<T>(items: T[], query: string, textOf: (item: T) => string): { item: T; match: FuzzyMatch }[] {
  return items
    .map((item) => ({ item, match: fuzzyMatch(query, textOf(item)) }))
    .filter((r): r is { item: T; match: FuzzyMatch } => r.match !== null)
    .sort((a, b) => b.match.score - a.match.score);
}

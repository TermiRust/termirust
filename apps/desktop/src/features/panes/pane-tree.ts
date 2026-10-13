/** A tab's layout: one pane, or a split into two sub-layouts. `row` puts children side by side. */
export type PaneNode =
  | { kind: "pane"; id: string }
  | { kind: "split"; id: string; direction: "row" | "column"; ratio: number; first: PaneNode; second: PaneNode };

export type Direction = "left" | "right" | "up" | "down";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;

export const singlePane = (id: string): PaneNode => ({ kind: "pane", id });

export function paneIds(node: PaneNode): string[] {
  return node.kind === "pane" ? [node.id] : [...paneIds(node.first), ...paneIds(node.second)];
}

/** Replaces pane `target` with a split holding it and a new pane `newId` after it. */
export function splitPane(node: PaneNode, target: string, direction: "row" | "column", newId: string, splitId: string): PaneNode {
  if (node.kind === "pane") {
    return node.id === target ? { kind: "split", id: splitId, direction, ratio: 0.5, first: node, second: singlePane(newId) } : node;
  }
  return { ...node, first: splitPane(node.first, target, direction, newId, splitId), second: splitPane(node.second, target, direction, newId, splitId) };
}

/** Removes a pane; its sibling takes the parent's place. Null when it was the last pane. */
export function closePane(node: PaneNode, target: string): PaneNode | null {
  if (node.kind === "pane") return node.id === target ? null : node;
  const first = closePane(node.first, target);
  const second = closePane(node.second, target);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

export function setRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.kind === "pane") return node;
  if (node.id === splitId) return { ...node, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) };
  return { ...node, first: setRatio(node.first, splitId, ratio), second: setRatio(node.second, splitId, ratio) };
}

/** Each pane's rectangle inside the unit square. */
export function paneRects(node: PaneNode, area: Rect = { x: 0, y: 0, w: 1, h: 1 }): Map<string, Rect> {
  if (node.kind === "pane") return new Map([[node.id, area]]);
  const [a, b]: [Rect, Rect] =
    node.direction === "row"
      ? [
          { ...area, w: area.w * node.ratio },
          { ...area, x: area.x + area.w * node.ratio, w: area.w * (1 - node.ratio) },
        ]
      : [
          { ...area, h: area.h * node.ratio },
          { ...area, y: area.y + area.h * node.ratio, h: area.h * (1 - node.ratio) },
        ];
  return new Map([...paneRects(node.first, a), ...paneRects(node.second, b)]);
}

const EPSILON = 1e-9;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** The pane touching `from` on that side, preferring the one sharing the longest edge. */
export function neighbour(node: PaneNode, from: string, direction: Direction): string | null {
  const rects = paneRects(node);
  const origin = rects.get(from);
  if (!origin) return null;
  let best: { id: string; shared: number } | null = null;
  for (const [id, r] of rects) {
    if (id === from) continue;
    const touches =
      direction === "left"
        ? Math.abs(r.x + r.w - origin.x) < EPSILON
        : direction === "right"
          ? Math.abs(origin.x + origin.w - r.x) < EPSILON
          : direction === "up"
            ? Math.abs(r.y + r.h - origin.y) < EPSILON
            : Math.abs(origin.y + origin.h - r.y) < EPSILON;
    if (!touches) continue;
    const shared = direction === "left" || direction === "right" ? overlap(origin.y, origin.y + origin.h, r.y, r.y + r.h) : overlap(origin.x, origin.x + origin.w, r.x, r.x + r.w);
    if (shared > EPSILON && (!best || shared > best.shared)) best = { id, shared };
  }
  return best?.id ?? null;
}

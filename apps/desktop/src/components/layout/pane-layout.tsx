import { useRef, type PointerEvent, type ReactNode } from "react";

import { paneIds, paneRects, splitDividers, type Divider, type PaneNode } from "@/features/panes/pane-tree";
import { cn } from "@/lib/utils";

interface PaneLayoutProps {
  layout: PaneNode;
  focusedPaneId: string;
  /** Orange frame on every pane while keystrokes go to all of them. */
  broadcast: boolean;
  onFocusPane: (paneId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  renderPane: (paneId: string, focused: boolean, multiple: boolean) => ReactNode;
}

const pct = (n: number) => `${n * 100}%`;

/**
 * Panes are rendered as one flat, absolutely positioned list keyed by pane id, so splitting or
 * closing a neighbour never remounts a pane (which would drop its SSH session).
 */
export function PaneLayout({ layout, focusedPaneId, broadcast, onFocusPane, onResize, renderPane }: PaneLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rects = paneRects(layout);
  const ids = paneIds(layout);
  const multiple = ids.length > 1;

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden">
      {ids.map((id) => {
        const r = rects.get(id) ?? { x: 0, y: 0, w: 1, h: 1 };
        const focused = id === focusedPaneId;
        return (
          <div
            key={id}
            role={multiple ? "group" : undefined}
            aria-label={multiple ? `Pane ${ids.indexOf(id) + 1}${focused ? " (focused)" : ""}` : undefined}
            data-pane-id={id}
            onPointerDownCapture={() => !focused && onFocusPane(id)}
            className={cn("absolute flex flex-col", multiple && "p-px", multiple && focused && !broadcast && "shadow-[inset_0_0_0_1px_var(--color-accent)]", broadcast && "shadow-[inset_0_0_0_2px_var(--color-accent)]")}
            style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
          >
            {renderPane(id, focused, multiple)}
          </div>
        );
      })}
      {splitDividers(layout).map((d) => (
        <DividerHandle key={d.splitId} divider={d} containerRef={containerRef} onResize={onResize} />
      ))}
    </div>
  );
}

function DividerHandle({ divider, containerRef, onResize }: { divider: Divider; containerRef: React.RefObject<HTMLDivElement | null>; onResize: (splitId: string, ratio: number) => void }) {
  const { area, ratio, direction, splitId } = divider;
  const row = direction === "row";

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    const bounds = container.getBoundingClientRect();
    const move = (e: globalThis.PointerEvent) => {
      const position = row ? (e.clientX - bounds.left) / bounds.width : (e.clientY - bounds.top) / bounds.height;
      const start = row ? area.x : area.y;
      const size = row ? area.w : area.h;
      if (size > 0) onResize(splitId, (position - start) / size);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const style = row
    ? { left: `calc(${pct(area.x + area.w * ratio)} - 3px)`, top: pct(area.y), height: pct(area.h), width: 6 }
    : { top: `calc(${pct(area.y + area.h * ratio)} - 3px)`, left: pct(area.x), width: pct(area.w), height: 6 };
  return (
    <div
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-label="Resize panes"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        const step = e.key === (row ? "ArrowLeft" : "ArrowUp") ? -0.05 : e.key === (row ? "ArrowRight" : "ArrowDown") ? 0.05 : 0;
        if (step !== 0) {
          e.preventDefault();
          onResize(splitId, ratio + step);
        }
      }}
      className={cn("absolute z-10 bg-transparent hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none", row ? "cursor-col-resize" : "cursor-row-resize")}
      style={style}
    />
  );
}

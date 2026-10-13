import { Server } from "lucide-react";
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { HostView } from "@/bindings";

const THRESHOLD = 5;
/** Where a host can be dropped: a group id, or "" for "no group". */
export const DROP_ATTR = "data-drop-group";

function targetAt(x: number, y: number): string | undefined {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${DROP_ATTR}]`);
  return el?.getAttribute(DROP_ATTR) ?? undefined;
}

/**
 * Pointer-based dragging of hosts onto groups (works whether or not the webview intercepts
 * native drag and drop). A small press without movement stays a click.
 */
export function useHostDrag(onDrop: (hostId: string, groupId: string | null) => void) {
  const [drag, setDrag] = useState<{ host: HostView; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<string | undefined>(undefined);
  const onDropRef = useRef(onDrop);
  useLayoutEffect(() => {
    onDropRef.current = onDrop;
  });

  const onPointerDown = (event: ReactPointerEvent, host: HostView) => {
    if (event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    let over: string | undefined;
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
      moved = true;
      over = targetAt(e.clientX, e.clientY);
      setDrag({ host, x: e.clientX, y: e.clientY });
      setTarget(over);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      setTarget(undefined);
      if (!moved || over === undefined) return;
      const groupId = over === "" ? null : over;
      if (groupId !== (host.groupId ?? null)) onDropRef.current(host.id, groupId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ghost = drag && (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-md border border-accent bg-bg px-2 py-1 text-xs shadow-dialog"
      style={{ left: drag.x + 12, top: drag.y + 8 }}
    >
      <Server size={12} className="text-fg-muted" /> {drag.host.label}
    </div>
  );

  return { onPointerDown, dropTarget: drag ? target : undefined, draggingId: drag?.host.id ?? null, ghost };
}

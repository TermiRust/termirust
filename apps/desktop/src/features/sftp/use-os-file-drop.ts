import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useLayoutEffect, useRef } from "react";

/** Is the remote panel of a visible SFTP tab under this physical-pixel position? */
export function overRemotePanel(position: { x: number; y: number }, scale = window.devicePixelRatio || 1): boolean {
  const element = document.elementFromPoint(position.x / scale, position.y / scale);
  return element?.closest<HTMLElement>("[data-drop-side]")?.dataset.dropSide === "remote";
}

/**
 * Uploads files dragged in from the OS onto the server panel. Hidden tabs never match because
 * hit-testing only finds visible elements.
 */
export function useOsFileDrop(enabled: boolean, onDrop: (paths: string[]) => void, onHover: (side: "remote" | null) => void) {
  const handlers = useRef({ onDrop, onHover });
  useLayoutEffect(() => {
    handlers.current = { onDrop, onHover };
  });

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    let hovering = false;
    try {
      void getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "leave") {
            if (hovering) handlers.current.onHover(null);
            hovering = false;
            return;
          }
          const over = overRemotePanel(payload.position);
          if (payload.type === "drop") {
            if (hovering) handlers.current.onHover(null);
            hovering = false;
            if (over && payload.paths.length > 0) handlers.current.onDrop(payload.paths);
          } else if (over !== hovering) {
            hovering = over;
            handlers.current.onHover(over ? "remote" : null);
          }
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        }, () => {});
    } catch {
      // Not running inside Tauri (tests, plain browser preview).
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled]);
}

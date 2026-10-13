import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Minimise / maximise / close for Windows, where the native title bar is turned off so the
 * top bar can take its place (as the overlay title bar does on macOS).
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      const win = getCurrentWindow();
      const refresh = () => void win.isMaximized().then((m) => !disposed && setMaximized(m), () => {});
      refresh();
      void win.onResized(refresh).then(
        (stop) => (disposed ? stop() : (unlisten = stop)),
        () => {},
      );
    } catch {
      // Not inside Tauri (tests, browser preview).
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const run = (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      void getCurrentWindow()[action]();
    } catch {
      // Not inside Tauri.
    }
  };

  const button = "grid h-[38px] w-[46px] place-items-center text-fg-2 transition-colors";
  return (
    <div className="ml-1 flex self-stretch">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => run("minimize")} className={cn(button, "hover:bg-hover")}>
        <Minus size={15} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => run("toggleMaximize")}
        className={cn(button, "hover:bg-hover")}
      >
        {maximized ? <Copy size={12} strokeWidth={1.5} className="-scale-x-100" /> : <Square size={12} strokeWidth={1.5} />}
      </button>
      <button type="button" aria-label="Close" title="Close" onClick={() => run("close")} className={cn(button, "hover:bg-[#c42b1c] hover:text-white")}>
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

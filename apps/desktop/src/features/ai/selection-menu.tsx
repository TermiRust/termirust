import { Copy, Sparkles } from "lucide-react";

/** Right-click menu over selected terminal text. */
export function SelectionMenu({ x, y, onAsk, onCopy, onClose }: { x: number; y: number; onAsk: () => void; onCopy: () => void; onClose: () => void }) {
  const item = "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none";
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-30" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div
        role="menu"
        aria-label="Selection"
        className="fixed z-40 min-w-48 rounded-md border border-border bg-bg p-1 shadow-dialog"
        style={{ left: x, top: y }}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <button type="button" role="menuitem" autoFocus className={item} onClick={onAsk}>
          <Sparkles size={13} className="text-accent" /> Ask AI about selection
        </button>
        <button type="button" role="menuitem" className={item} onClick={onCopy}>
          <Copy size={13} className="text-fg-muted" /> Copy
        </button>
      </div>
    </>
  );
}

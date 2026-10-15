import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  width?: "sm" | "md" | "lg" | "xl";
  /** False hides the close button, for a dialog the user must answer. */
  dismissible?: boolean;
  children: ReactNode;
}

const widths = { sm: "w-[min(420px,calc(100vw-32px))]", md: "w-[min(520px,calc(100vw-32px))]", lg: "w-[min(640px,calc(100vw-32px))]", xl: "w-[min(1040px,calc(100vw-32px))]" };

export function Dialog({ open, onOpenChange, title, description, icon, tone = "default", width = "md", dismissible = true, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Dialogs sit above everything in the app (panels use z-10, menus z-30/40). */}
        <DialogPrimitive.Overlay className="motion-overlay fixed inset-0 z-50 bg-scrim" />
        {/* Centred by grid, not translate(-50%): a half-pixel offset blurs text in WebKit. */}
        <div data-dialog-layer className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <DialogPrimitive.Content
          className={cn(
            "motion-dialog pointer-events-auto flex max-h-[85vh] flex-col overflow-hidden rounded-xl border bg-bg shadow-dialog",
            tone === "danger" ? "border-danger-border" : "border-border",
            widths[width],
          )}
        >
          <div className={cn("flex items-start gap-3 px-5 pt-4 pb-3", tone === "danger" && "bg-danger-soft")}>
            {icon && (
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                  tone === "danger" ? "border-danger-border text-danger" : "border-border bg-bg-sunk text-fg-muted",
                )}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className={cn("text-[15px] font-semibold", tone === "danger" && "text-danger")}>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={description ? "mt-0.5 text-[13px] text-fg-muted" : "sr-only"}>
                {description ?? title}
              </DialogPrimitive.Description>
            </div>
            {dismissible && (
              <DialogPrimitive.Close aria-label="Close" className="rounded p-1 text-fg-muted hover:bg-hover">
                <X size={16} />
              </DialogPrimitive.Close>
            )}
          </div>
          <div className="overflow-y-auto px-5 pt-1 pb-4">{children}</div>
        </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Right-aligned action row with a hairline above, as in the mockup dialogs. */
export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("-mx-5 mt-4 -mb-4 flex items-center gap-2 border-t border-border bg-bg-sunk px-5 py-3", className)}>{children}</div>;
}

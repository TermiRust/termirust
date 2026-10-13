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
  width?: "sm" | "md" | "lg";
  children: ReactNode;
}

const widths = { sm: "w-[min(420px,calc(100vw-32px))]", md: "w-[min(520px,calc(100vw-32px))]", lg: "w-[min(640px,calc(100vw-32px))]" };

export function Dialog({ open, onOpenChange, title, description, icon, tone = "default", width = "md", children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="motion-overlay fixed inset-0 bg-scrim" />
        <DialogPrimitive.Content
          className={cn(
            "motion-dialog fixed top-1/2 left-1/2 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border bg-bg shadow-dialog",
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
            <DialogPrimitive.Close aria-label="Close" className="rounded p-1 text-fg-muted hover:bg-hover">
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto px-5 pt-1 pb-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Right-aligned action row with a hairline above, as in the mockup dialogs. */
export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("-mx-5 mt-4 -mb-4 flex items-center gap-2 border-t border-border bg-bg-sunk px-5 py-3", className)}>{children}</div>;
}

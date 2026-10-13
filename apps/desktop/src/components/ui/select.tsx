import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

import { controlClass } from "./input";

/** Native select (keyboard and screen-reader behaviour for free) styled like the inputs. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(controlClass, "appearance-none pr-7", className)} {...props}>
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-muted" />
    </div>
  );
}

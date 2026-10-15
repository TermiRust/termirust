import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const controlClass =
  "h-8 w-full rounded-md border border-border-strong bg-bg-elev px-2.5 text-[13px] text-fg placeholder:text-fg-faint transition-shadow focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-ring)] focus-visible:outline-none aria-invalid:border-danger disabled:opacity-50";

/**
 * Usernames, hostnames, paths and commands are case-sensitive: the OS must not capitalise or
 * "correct" them (macOS does so in web inputs when its text substitutions are on).
 */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input autoCapitalize="off" autoCorrect="off" spellCheck={false} className={cn(controlClass, className)} {...props} />;
}

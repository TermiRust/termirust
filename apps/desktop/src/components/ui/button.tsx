import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors outline-offset-1 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:brightness-105 active:brightness-95",
        outline: "border border-border-strong bg-bg-elev text-fg hover:bg-hover active:bg-active",
        ghost: "text-fg-2 hover:bg-hover hover:text-fg active:bg-active",
        danger: "border border-danger-border bg-danger-soft text-danger hover:brightness-105",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-[13px]",
        icon: "h-7 w-7",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}

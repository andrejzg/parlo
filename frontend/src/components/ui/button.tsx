import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Parlo1 button (gui/themes/parlo1-components.md → Button).
 * Control: pill, text s / ui / medium / tracking l, gap xs, padding s×l,
 * no native border, 2px focus outline in the accent, 1px press.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-xs whitespace-nowrap rounded-full font-ui text-s font-medium tracking-l transition-[background-color,color,box-shadow,transform] active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none disabled:translate-y-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:shadow-s disabled:bg-muted disabled:text-neutral-6",
        secondary: "bg-secondary text-secondary-foreground hover:bg-neutral-4 disabled:bg-muted disabled:text-neutral-6",
        outline: "bg-transparent text-foreground shadow-edge hover:bg-accent disabled:text-neutral-6 disabled:shadow-edge-transparent",
        ghost: "bg-transparent text-foreground hover:bg-accent disabled:text-neutral-6",
        destructive: "bg-destructive text-destructive-foreground hover:shadow-s disabled:bg-muted disabled:text-neutral-6",
        link: "bg-transparent text-foreground underline-offset-4 hover:underline disabled:text-neutral-6",
      },
      size: {
        default: "px-l py-s",
        sm: "px-m py-xs text-xs",
        // App composition for the primary mobile call to action: theme tokens
        // one step up (padding m×xl, text m) so the bottom button is 56px tall.
        lg: "px-xl py-m text-m",
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

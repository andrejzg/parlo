import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Parlo1 text field (gui/themes/parlo1-components.md → Text field).
 * Fill neutral-3, radius s, padding s×m, text s / ui / regular, no native
 * border; focus draws the accent outline, invalid tints the fill with
 * error-transparent, read-only uses the surface fill with neutral-8 text.
 */
const inputClassName =
  "flex w-full rounded-s bg-input px-m py-s font-ui text-s font-regular tracking-l text-foreground placeholder:text-muted-foreground transition-[background-color,color,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring aria-[invalid=true]:bg-error-transparent read-only:bg-card read-only:text-neutral-8 disabled:cursor-not-allowed disabled:text-neutral-6 file:border-0 file:bg-transparent file:text-s file:font-medium file:text-foreground";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return <input type={type} className={cn(inputClassName, className)} ref={ref} {...props} />;
  },
);
Input.displayName = "Input";

export { Input, inputClassName };

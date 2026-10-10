import * as React from "react";

import { cn } from "@/lib/utils";
import { inputClassName } from "@/components/ui/input";

/** Multi-line Parlo1 text field — same treatment as `Input`. */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return <textarea className={cn(inputClassName, "resize-none", className)} ref={ref} {...props} />;
  },
);
Textarea.displayName = "Textarea";

export { Textarea };

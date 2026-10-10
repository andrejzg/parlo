import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

/**
 * Parlo1 tooltip (gui/themes/parlo1-components.md → Tooltip).
 * Popover: neutral-10 fill with neutral-1 text, radius s, padding xxs×xs,
 * text xs medium, shadow m, small motion with the theme's popup scale.
 */

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-s bg-neutral-10 px-xs py-xxs font-ui text-xs font-medium tracking-l text-neutral-1 shadow-m animate-in fade-in-0 zoom-in-[var(--motion-popup-scale)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[var(--motion-popup-scale)]",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };

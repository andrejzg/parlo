import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Parlo1 switch (gui/themes/parlo1-components.md → Switch).
 * Track: controlSize xl (32px), neutral-4 at rest, accent when checked,
 * neutral-3 when disabled. Thumb: controlSize l (24px), neutral-1 fill,
 * neutral-6 when disabled. No native border; focus draws the accent outline.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-xl w-[calc(var(--space-xl)*2-var(--space-xs))] shrink-0 cursor-pointer items-center rounded-full p-xxs transition-colors data-[state=unchecked]:bg-neutral-4 data-[state=checked]:bg-color-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-l w-l rounded-full bg-neutral-1 transition-transform data-[state=checked]:translate-x-l data-[state=unchecked]:translate-x-0 peer-disabled:bg-neutral-6 group-disabled:bg-neutral-6",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

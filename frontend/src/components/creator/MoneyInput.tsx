import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { currencySymbol } from "@/components/creator/studyUi";

interface MoneyInputProps extends Omit<React.ComponentProps<"input">, "type" | "value" | "onChange"> {
  /** ISO code; its sign sits inside the field. */
  currency: string;
  /** Dollars, as typed. */
  value: string;
  onValueChange: (value: string) => void;
}

/** A dollars field with the currency sign inside it. `className` sizes the wrapper. */
const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ currency, value, onValueChange, className, ...props }, ref) => {
    const symbol = currencySymbol(currency);
    return (
      <div className={cn("relative", className)}>
        <span className="pointer-events-none absolute left-m top-1/2 -translate-y-1/2 font-data text-s text-muted-foreground" aria-hidden>
          {symbol}
        </span>
        <Input
          ref={ref}
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="font-data tabular-nums"
          // Structural: room for the sign, which is one to three characters wide.
          style={{ paddingLeft: `calc(var(--space-m) + ${symbol.length}ch + var(--space-xxs))` }}
          {...props}
        />
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";

export { MoneyInput };

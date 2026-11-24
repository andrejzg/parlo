/**
 * Small helpers shared by the research-team UI on the dashboard
 * (round pricing, the Rewards card, bringing people in).
 * Money is dollars on screen and integer cents on the wire.
 */
import { toast } from "@/components/ui/sonner";

/** "10" → 1000, "12.5" → 1250, "0" → 0. Empty or unreadable → null (none). */
export function dollarsToCents(value: string): number | null {
  if (!value.trim()) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** 1000 → "10", 1250 → "12.50". null → "" (an empty field). */
export function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const amount = cents / 100;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** "$" for USD, "€" for EUR, "CA$" for CAD. Falls back to the code. */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy. Select it and copy by hand.");
  }
}

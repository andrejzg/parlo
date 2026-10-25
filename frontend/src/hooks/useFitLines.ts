import { useLayoutEffect, useRef, useState } from "react";

/**
 * Step a text's type size down the theme scale until it fits in `maxLines`.
 *
 * The outputs deck's card titles are `text-m`; "Google Sheet & Drive" takes
 * three lines at 320 px and makes its row taller than the others. Rather than
 * a smaller size for that one label (a visual exception) or an arbitrary px
 * value (off the scale), the title tries `steps[0]`, measures, and steps down
 * only as far as it must. Every size stays a theme step (`text-m`, `text-s`,
 * `text-xs`, with their own line height), so the card still reads as the deck.
 *
 * Measures with `useLayoutEffect`, so the first paint is already the right
 * size. Re-measures when the element's width changes (viewport, grid, font
 * load), starting again from the largest step so a wider screen grows back.
 */
export function useFitLines<T extends HTMLElement>(maxLines: number, steps: readonly string[]): {
  ref: React.RefObject<T>;
  className: string;
} {
  const ref = useRef<T>(null);
  const [step, setStep] = useState(0);
  const widthRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    const lines = Math.round(el.getBoundingClientRect().height / lineHeight);
    if (lines > maxLines && step < steps.length - 1) setStep(step + 1);
  }, [step, maxLines, steps]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    widthRef.current = el.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined || width === widthRef.current) return;
      widthRef.current = width;
      setStep(0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, className: steps[step] ?? steps[steps.length - 1] };
}

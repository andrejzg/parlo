import { useEffect } from "react";

/**
 * Sets a `--vvh` CSS variable on the document root that always reflects
 * the actual visible viewport height (accounting for the on-screen keyboard
 * on iOS Safari). Use `var(--vvh, 100svh)` instead of `100svh` for any
 * full-screen container that needs to stay above the keyboard.
 *
 * Also locks body scroll so iOS Safari can't auto-scroll the page when an
 * input gets focus, which would push the layout above the visible area.
 *
 * This is what ChatGPT, Linear, and Notion's mobile web do.
 */
export function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
      // Reset any scroll iOS may have applied
      window.scrollTo(0, 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    // Lock body scroll so iOS can't push the layout up when focusing inputs
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.width = "";
    };
  }, []);
}

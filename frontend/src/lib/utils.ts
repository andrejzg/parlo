import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's default scales. tailwind.config.ts
 * replaces them with the Parlo1 vocabulary (see index.css), so the custom
 * keys are registered here — otherwise `cn("text-s", "text-xs")` would keep
 * both classes and `className` overrides on shared components would not win.
 */
const SPACING = ["zero", "xxs", "xs", "s", "m", "l", "xl", "xxl"];
const TEXT_STEPS = ["xxs", "xs", "s", "m", "l", "xl", "xxl"];

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: SPACING,
      borderRadius: ["none", "xs", "s", "m", "l", "xl", "full"],
      borderWidth: ["s", "m", "l"],
      scale: ["popup"],
      translate: ["press"],
    },
    classGroups: {
      "font-size": [{ text: TEXT_STEPS }],
      "font-weight": [{ font: ["regular", "medium", "heavy"] }],
      "font-family": [{ font: ["ui", "brand", "editorial", "data"] }],
      leading: [{ leading: ["none", ...TEXT_STEPS] }],
      tracking: [{ tracking: ["xs", "s", "m", "l", "xl"] }],
      shadow: [{ shadow: ["none", "s", "m", "l", "edge", "edge-t", "edge-b", "edge-l", "edge-r", "edge-accent", "edge-transparent"] }],
      duration: [{ duration: ["large"] }],
      ease: [{ ease: ["large", "linear"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

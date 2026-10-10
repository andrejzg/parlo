/**
 * Shared Framer Motion values for the Parlo1 theme.
 *
 * Mirrors the theme's motion tokens in src/index.css:
 *   --motion-duration        160ms   small motion (controls, menus, small popovers)
 *   --motion-large-duration  280ms   large motion (screens, dialogs, drawers, toasts)
 *   --motion-easing          cubic-bezier(0.16, 1, 0.3, 1)
 *   --motion-popup-scale     0.96
 *   --motion-press-distance  1px
 *
 * Framer Motion takes seconds, so the durations are divided by 1000 here.
 * Direction-aware page transitions:
 *   custom = 1 (forward): enter from below, exit upward
 *   custom = -1 (back):   enter from above, exit downward
 */

export const MOTION = {
  duration: 0.16,
  largeDuration: 0.28,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
  popupScale: 0.96,
  pressDistance: 1,
} as const;

export const EASE = MOTION.ease;

/** Small-motion transition (controls, pills, inline state changes). */
export const transitionSmall = { duration: MOTION.duration, ease: EASE };

/** Large-motion transition (screens, sheets, toasts, disclosure panels). */
export const transitionLarge = { duration: MOTION.largeDuration, ease: EASE };

/** `whileTap` press feedback — the theme's 1px press, not a scale. */
export const press = { y: MOTION.pressDistance };

/** Popup enter/exit (menus, popovers) — scale from the theme's popup scale. */
export const popup = {
  initial: { opacity: 0, scale: MOTION.popupScale },
  animate: { opacity: 1, scale: 1, transition: transitionSmall },
  exit: { opacity: 0, scale: MOTION.popupScale, transition: transitionSmall },
};

/** Direction-aware page enter/exit (used by AnimatePresence wrappers). */
export const pageVariants = {
  initial: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? 24 : -24,
  }),
  animate: {
    opacity: 1,
    y: 0,
    transition: transitionLarge,
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? -16 : 16,
    transition: transitionSmall,
  }),
};

/** Stagger container for groups of elements. */
export const stagger = {
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
};

/** Standard fade-up for individual items. */
export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: transitionLarge,
  },
};

/** Slightly larger travel fade-up for question text. */
export const questionFadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: transitionLarge,
  },
};

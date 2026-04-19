/**
 * Shared Framer Motion animation variants used across the app.
 * All easing curves follow the same design language:
 *   - Enter: fast-start, soft-settle  [0.22, 1, 0.36, 1]
 *   - Exit:  fast ease-in upward fade [0.55, 0, 1, 0.45]
 *
 * Direction-aware page transitions:
 *   custom = 1 (forward): enter from below, exit upward
 *   custom = -1 (back):   enter from above, exit downward
 */

const EASE_ENTER = [0.22, 1, 0.36, 1] as number[];
const EASE_EXIT = [0.55, 0, 1, 0.45] as number[];

/** Direction-aware page enter/exit (used by AnimatePresence wrappers) */
export const pageVariants = {
  initial: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? 36 : -36,
    scale: 0.98,
  }),
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.38,
      ease: EASE_ENTER,
    },
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? -24 : 24,
    scale: 1.01,
    transition: {
      duration: 0.22,
      ease: EASE_EXIT,
    },
  }),
};

/** Stagger container for groups of elements */
export const stagger = {
  animate: { transition: { staggerChildren: 0.08, delayChildren: 0.08 } },
};

/** Standard fade-up for individual items */
export const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: EASE_ENTER },
  },
};

/** Slightly larger travel fade-up for question text */
export const questionFadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_ENTER },
  },
};

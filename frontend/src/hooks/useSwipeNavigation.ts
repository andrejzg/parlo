import { useRef, useCallback } from "react";

interface UseSwipeNavigationOptions {
  onSwipeLeft?: () => void;   // next
  onSwipeRight?: () => void;  // back
  threshold?: number;         // min px to trigger (default 60)
  enabled?: boolean;
}

/**
 * Lightweight horizontal swipe detection for touch devices.
 * Returns onTouchStart / onTouchEnd handlers to attach to a container.
 */
export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  threshold = 60,
  enabled = true,
}: UseSwipeNavigationOptions) {
  const startX = useRef(0);
  const startY = useRef(0);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
    },
    [enabled],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - startX.current;
      const dy = endY - startY.current;

      // Only trigger if horizontal movement is dominant
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return;

      if (dx < 0 && onSwipeLeft) {
        onSwipeLeft();
      } else if (dx > 0 && onSwipeRight) {
        onSwipeRight();
      }
    },
    [enabled, threshold, onSwipeLeft, onSwipeRight],
  );

  return { onTouchStart, onTouchEnd };
}

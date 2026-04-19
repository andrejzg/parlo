import { useRef, useState, useCallback } from "react";

interface UseSwipe2DOptions {
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  canSwipeUp?: boolean;
  canSwipeDown?: boolean;
  canSwipeLeft?: boolean;
  canSwipeRight?: boolean;
  threshold?: number;
  lockThreshold?: number;
}

interface UseSwipe2DReturn {
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
  /** Current swipe offset in pixels (for visual feedback during drag) */
  offset: { x: number; y: number };
  /** Which axis is currently locked during a gesture, or null */
  axis: "x" | "y" | null;
  /** Whether a swipe gesture is currently in progress */
  isSwiping: boolean;
}

const ZERO = { x: 0, y: 0 };
const DAMPEN = 0.3;

export function useSwipe2D(options: UseSwipe2DOptions): UseSwipe2DReturn {
  const {
    onSwipeUp,
    onSwipeDown,
    onSwipeLeft,
    onSwipeRight,
    canSwipeUp = true,
    canSwipeDown = true,
    canSwipeLeft = true,
    canSwipeRight = true,
    threshold = 50,
    lockThreshold = 10,
  } = options;

  // Refs for gesture tracking (no re-renders during gesture)
  const startX = useRef(0);
  const startY = useRef(0);
  const lockedAxis = useRef<"x" | "y" | null>(null);
  const tracking = useRef(false);
  const lastDelta = useRef(ZERO);

  // Stable refs for callbacks so onTouchEnd doesn't go stale
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // State exposed to parent for visual feedback
  const [offset, setOffset] = useState(ZERO);
  const [axis, setAxis] = useState<"x" | "y" | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    lockedAxis.current = null;
    tracking.current = true;
    lastDelta.current = ZERO;
    setAxis(null);
    setIsSwiping(false);
    setOffset(ZERO);
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!tracking.current || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;

      // Lock axis once movement exceeds lockThreshold
      if (lockedAxis.current === null) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < lockThreshold && absDy < lockThreshold) return;
        const locked = absDx >= absDy ? "x" : "y";
        lockedAxis.current = locked;
        setAxis(locked);
        setIsSwiping(true);
      }

      // Prevent scroll when swiping vertically
      if (lockedAxis.current === "y") {
        e.preventDefault();
      }

      // Compute offset along locked axis, with rubber-band damping
      let newOffset: { x: number; y: number };
      if (lockedAxis.current === "x") {
        const allowed =
          dx < 0 ? canSwipeLeft : dx > 0 ? canSwipeRight : true;
        newOffset = { x: allowed ? dx : dx * DAMPEN, y: 0 };
      } else {
        const allowed =
          dy < 0 ? canSwipeUp : dy > 0 ? canSwipeDown : true;
        newOffset = { x: 0, y: allowed ? dy : dy * DAMPEN };
      }

      lastDelta.current = { x: dx, y: dy };
      setOffset(newOffset);
    },
    [canSwipeUp, canSwipeDown, canSwipeLeft, canSwipeRight, lockThreshold],
  );

  const onTouchEnd = useCallback((_e: React.TouchEvent) => {
    if (!tracking.current) return;
    tracking.current = false;

    const locked = lockedAxis.current;
    const delta = lastDelta.current;
    const opts = callbacksRef.current;
    const th = opts.threshold ?? 50;
    const csUp = opts.canSwipeUp ?? true;
    const csDown = opts.canSwipeDown ?? true;
    const csLeft = opts.canSwipeLeft ?? true;
    const csRight = opts.canSwipeRight ?? true;

    if (locked === "x") {
      if (Math.abs(delta.x) >= th) {
        if (delta.x < 0 && csLeft) opts.onSwipeLeft?.();
        else if (delta.x > 0 && csRight) opts.onSwipeRight?.();
      }
    } else if (locked === "y") {
      if (Math.abs(delta.y) >= th) {
        if (delta.y < 0 && csUp) opts.onSwipeUp?.();
        else if (delta.y > 0 && csDown) opts.onSwipeDown?.();
      }
    }

    lockedAxis.current = null;
    lastDelta.current = ZERO;
    setOffset(ZERO);
    setAxis(null);
    setIsSwiping(false);
  }, []);

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
    offset,
    axis,
    isSwiping,
  };
}

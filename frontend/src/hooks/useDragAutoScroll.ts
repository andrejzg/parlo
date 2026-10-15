import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Auto-scroll a list while one of its items is being dragged near the top
 * or bottom edge, so a card can be dragged above or below the fold.
 *
 * Framer Motion's drag (and so `Reorder`) has no notion of a scrolling
 * container: the dragged item's offset is the raw pointer delta, so when
 * the container scrolls under a still finger the card drifts away from it
 * and the reorder check compares the wrong numbers. This hook fixes both
 * at the source. While a drag is on it:
 *
 * 1. scrolls the container each frame when the pointer sits in the edge
 *    zone, faster the closer to the edge;
 * 2. intercepts every `pointermove` on `window` in the capture phase and
 *    re-dispatches it with `clientY` shifted by the distance scrolled
 *    since the drag began. Framer measures every card in viewport
 *    coordinates at each reorder (all at the same scroll position), and
 *    the shifted pointer puts the finger in those same coordinates, so the
 *    card stays under the finger and reorders where it looks like it
 *    should. Each scroll tick also dispatches one synthetic move so the
 *    card follows the content while the finger is still.
 *
 * Returns `onDragStart` / `onDragEnd` to put on each `Reorder.Item`. Do
 * not add `layoutScroll` to the container: Framer caches that offset
 * between layout updates and a continuously scrolling list then throws
 * the other cards off by the stale amount at every reorder.
 */
const EDGE_ZONE_PX = 80;
const MAX_SPEED_PX_PER_FRAME = 10;

const ADJUSTED = Symbol("parlo-adjusted-pointer-move");
type AdjustedEvent = PointerEvent & { [ADJUSTED]?: true };

export function useDragAutoScroll(scrollRef: RefObject<HTMLElement | null>) {
  const dragging = useRef(false);
  const pointer = useRef({ x: 0, y: 0, id: 0, type: "mouse" });
  const scrolled = useRef(0);
  const raf = useRef<number | null>(null);

  const dispatchAdjustedMove = useCallback(() => {
    const { x, y, id, type } = pointer.current;
    const synthetic = new PointerEvent("pointermove", {
      clientX: x,
      clientY: y + scrolled.current,
      pointerId: id,
      pointerType: type,
      isPrimary: true,
      button: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
    }) as AdjustedEvent;
    synthetic[ADJUSTED] = true;
    window.dispatchEvent(synthetic);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      if ((e as AdjustedEvent)[ADJUSTED]) return;
      pointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
      if (scrolled.current === 0) return;
      // Framer must only ever see content-space positions once the list has scrolled.
      e.stopImmediatePropagation();
      dispatchAdjustedMove();
    },
    [dispatchAdjustedMove]
  );

  const tick = useCallback(() => {
    raf.current = null;
    if (!dragging.current) return;
    const el = scrollRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const y = pointer.current.y;
      let speed = 0;
      if (y < rect.top + EDGE_ZONE_PX) {
        speed = -MAX_SPEED_PX_PER_FRAME * Math.min(1, (rect.top + EDGE_ZONE_PX - y) / EDGE_ZONE_PX);
      } else if (y > rect.bottom - EDGE_ZONE_PX) {
        speed = MAX_SPEED_PX_PER_FRAME * Math.min(1, (y - (rect.bottom - EDGE_ZONE_PX)) / EDGE_ZONE_PX);
      }
      if (speed !== 0) {
        const before = el.scrollTop;
        el.scrollTop = before + speed;
        const moved = el.scrollTop - before;
        if (moved !== 0) {
          scrolled.current += moved;
          dispatchAdjustedMove();
        }
      }
    }
    raf.current = requestAnimationFrame(tick);
  }, [scrollRef, dispatchAdjustedMove]);

  const stop = useCallback(() => {
    dragging.current = false;
    scrolled.current = 0;
    window.removeEventListener("pointermove", onPointerMove, true);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, [onPointerMove]);

  const onDragStart = useCallback(
    (event: PointerEvent | MouseEvent | TouchEvent) => {
      const pe = event as PointerEvent;
      dragging.current = true;
      scrolled.current = 0;
      pointer.current = {
        x: pe.clientX ?? 0,
        y: pe.clientY ?? 0,
        id: pe.pointerId ?? 0,
        type: pe.pointerType ?? "mouse",
      };
      window.addEventListener("pointermove", onPointerMove, true);
      if (raf.current === null) raf.current = requestAnimationFrame(tick);
    },
    [onPointerMove, tick]
  );

  useEffect(() => stop, [stop]);

  return { onDragStart, onDragEnd: stop };
}

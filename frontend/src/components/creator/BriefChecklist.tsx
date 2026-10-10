import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import type { BriefChecklistState } from "@/hooks/useBriefChecklist";
import type { BriefItemId } from "@/lib/briefChecklist";
import { fadeUp, transitionLarge } from "@/lib/animations";

/**
 * The two faces of the brief checklist.
 *
 * - `BriefChecklistList` (voice mode): all five items as rows that tick green
 *   while the creator talks — there's no keyboard, so the whole list fits.
 * - `BriefStack` (type mode): one item at a time as a stack of cards on top of
 *   the screen. The front card is the first thing still to cover; when Jev
 *   ticks it, it shows its tick for a beat, flies off, and the next card comes
 *   forward. The model reads the whole brief each time, so items can tick out
 *   of order — the dots in the card's corner carry the true per-item state.
 */

/** The tick popping in: theme small-motion duration with a light bounce. */
const tickPop = { type: "spring" as const, visualDuration: 0.2, bounce: 0.2 };

function TickBadge({ satisfied, number }: { satisfied: boolean; number: number }) {
  return (
    <span
      className={`relative flex items-center justify-center shrink-0 w-6 h-6 rounded-full transition-[background-color,box-shadow,color] ${
        satisfied
          ? "bg-success text-neutral-1"
          : "shadow-[inset_0_0_0_1.5px_var(--neutral-5)] font-data text-xxs text-neutral-6"
      }`}
      aria-hidden
    >
      <AnimatePresence>
        {satisfied ? (
          <motion.span
            key="tick"
            className="flex"
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={tickPop}
          >
            <Check size={12} aria-hidden />
          </motion.span>
        ) : (
          <span key="num">{number}</span>
        )}
      </AnimatePresence>
    </span>
  );
}

// ── Voice mode: the full list ─────────────────────────────────────────

function ChecklistRow({ entry, index }: { entry: BriefChecklistState; index: number }) {
  const { satisfied, label, hint } = entry;
  return (
    // minHeight is structural: five rows must fit a 667px-tall phone without scrolling.
    <motion.li
      variants={fadeUp}
      className={`flex items-center gap-s rounded-s px-s transition-colors ${satisfied ? "bg-success-transparent" : "bg-card"}`}
      style={{ minHeight: "clamp(34px, 4.6svh, 40px)" }}
      data-testid={`brief-item-${entry.id}`}
      data-satisfied={satisfied ? "true" : "false"}
    >
      <TickBadge satisfied={satisfied} number={index + 1} />
      <div className="min-w-0 flex-1 flex items-baseline gap-xs">
        <span className="text-s font-medium text-foreground shrink-0">{label}</span>
        <span className={`text-xs truncate ${satisfied ? "text-success" : "text-muted-foreground"}`}>
          {satisfied ? "got it" : hint}
        </span>
      </div>
    </motion.li>
  );
}

export function BriefChecklistList({ items }: { items: BriefChecklistState[] }) {
  return (
    <motion.ul className="flex flex-col gap-xs list-none" aria-label="What to cover">
      {items.map((entry, i) => (
        <ChecklistRow key={entry.id} entry={entry} index={i} />
      ))}
    </motion.ul>
  );
}

// ── Type mode: the stack ──────────────────────────────────────────────

/** How long a freshly ticked card stays on show before the next comes forward. */
const HOLD_TICK_MS = 650;
/** Cards peeking out from behind the front one. */
const PEEK_CARDS = 2;
/** Structural: how far each peeking card sits below the one in front. */
const PEEK_OFFSET_PX = 6;

function StateDots({ items, currentId }: { items: BriefChecklistState[]; currentId: BriefItemId | null }) {
  return (
    <span className="flex items-center gap-xxs shrink-0" aria-label={`${items.filter((i) => i.satisfied).length} of ${items.length} covered`}>
      {items.map((entry) => (
        <span
          key={entry.id}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            entry.satisfied ? "bg-success" : entry.id === currentId ? "bg-color-1" : "bg-neutral-5"
          }`}
          data-testid={`brief-item-${entry.id}`}
          data-satisfied={entry.satisfied ? "true" : "false"}
        />
      ))}
    </span>
  );
}

export function BriefStack({ items }: { items: BriefChecklistState[] }) {
  const firstOpenId = items.find((i) => !i.satisfied)?.id ?? null;
  const [shownId, setShownId] = useState<BriefItemId | null>(firstOpenId);
  const shown = shownId ? items.find((i) => i.id === shownId) ?? null : null;
  const shownSatisfied = shown?.satisfied ?? false;

  // Move on to the next open item: after a beat when the card on show just got
  // its tick (so the tick is seen), at once when an earlier item came untick.
  useEffect(() => {
    if (shownId === firstOpenId) return;
    const t = setTimeout(() => setShownId(firstOpenId), shownSatisfied ? HOLD_TICK_MS : 0);
    return () => clearTimeout(t);
  }, [firstOpenId, shownId, shownSatisfied]);

  const behind = Math.min(
    PEEK_CARDS,
    items.filter((i) => !i.satisfied && i.id !== shownId).length,
  );
  const number = shown ? items.indexOf(shown) + 1 : items.length;

  return (
    <div className="relative" style={{ paddingBottom: PEEK_CARDS * PEEK_OFFSET_PX }} aria-live="polite">
      {Array.from({ length: behind }).map((_, i) => (
        <div
          key={i}
          className="absolute inset-x-0 top-0 rounded-m bg-card"
          style={{
            bottom: PEEK_CARDS * PEEK_OFFSET_PX,
            transform: `translateY(${(i + 1) * PEEK_OFFSET_PX}px) scale(${1 - (i + 1) * 0.04})`,
            opacity: 0.55 - i * 0.25,
            zIndex: PEEK_CARDS - i,
          }}
          aria-hidden
        />
      ))}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={shownId ?? "done"}
          className={`relative z-10 flex items-start gap-s rounded-m p-m transition-colors ${
            !shown || shownSatisfied ? "bg-success-transparent" : "bg-card"
          }`}
          initial={{ opacity: 0, y: PEEK_OFFSET_PX, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24 }}
          transition={transitionLarge}
          data-testid={shown ? "brief-stack-current" : "brief-stack-done"}
          data-item={shown?.id}
          data-satisfied={shownSatisfied ? "true" : "false"}
        >
          <TickBadge satisfied={!shown || shownSatisfied} number={number} />
          <div className="min-w-0 flex-1">
            <p className="text-m font-medium text-foreground">{shown ? shown.label : "All five covered"}</p>
            <p className={`text-s ${!shown || shownSatisfied ? "text-success" : "text-muted-foreground"}`}>
              {!shown ? "Add anything else, or continue." : shownSatisfied ? "Got it" : shown.hint}
            </p>
          </div>
          <StateDots items={items} currentId={shownId} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

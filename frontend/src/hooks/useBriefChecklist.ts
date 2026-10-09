import { useCallback, useEffect, useRef, useState } from "react";
import { evaluateBrief } from "@/api/client";
import { captureException } from "@/lib/posthog";
import {
  BRIEF_CHECKLIST,
  BRIEF_TICK_THRESHOLD,
  BRIEF_UNTICK_THRESHOLD,
  type BriefItemId,
} from "@/lib/briefChecklist";

export interface BriefChecklistState {
  id: BriefItemId;
  label: string;
  hint: string;
  satisfied: boolean;
  probability: number;
}

type ItemState = Record<BriefItemId, { satisfied: boolean; probability: number }>;

const EMPTY: ItemState = {
  audience: { satisfied: false, probability: 0 },
  goal: { satisfied: false, probability: 0 },
  purpose: { satisfied: false, probability: 0 },
  tone: { satisfied: false, probability: 0 },
  length: { satisfied: false, probability: 0 },
};

const DEBOUNCE_MS = 650;
const MIN_CHARS = 12;

/**
 * Keeps the brief checklist in sync with a changing transcript.
 *
 * Every time `text` settles for ~650 ms we send it to
 * POST /api/surveys/:id/brief/evaluate (TypeSafe Jev, ~300 ms) and merge the
 * probabilities in with hysteresis: an item ticks at ≥ 0.7 and only unticks
 * again below 0.45, so a single jittery read can't flicker a green tick off.
 * One request in flight at a time; if the text moved on meanwhile we run
 * once more with the latest text as soon as the current call returns.
 */
export function useBriefChecklist(surveyId: string | null, text: string) {
  const [state, setState] = useState<ItemState>(EMPTY);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluatedOnce, setEvaluatedOnce] = useState(false);

  const lastEvaluatedRef = useRef("");
  const inFlightRef = useRef(false);
  const pendingRef = useRef<string | null>(null);

  const runEval = useCallback(
    async (t: string) => {
      if (!surveyId) return;
      if (inFlightRef.current) {
        pendingRef.current = t;
        return;
      }
      inFlightRef.current = true;
      setEvaluating(true);
      try {
        const res = await evaluateBrief(surveyId, t);
        lastEvaluatedRef.current = t;
        setState((prev) => {
          const next = { ...prev };
          for (const item of res.items) {
            const id = item.id as BriefItemId;
            if (!(id in next)) continue;
            const p = item.probability;
            const was = next[id].satisfied;
            const satisfied = was ? p >= BRIEF_UNTICK_THRESHOLD : p >= BRIEF_TICK_THRESHOLD;
            next[id] = { satisfied, probability: p };
          }
          return next;
        });
        setEvaluatedOnce(true);
      } catch (err) {
        captureException(err, { location: "useBriefChecklist.evaluate" });
      } finally {
        inFlightRef.current = false;
        setEvaluating(false);
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending && pending !== lastEvaluatedRef.current) {
          void runEval(pending);
        }
      }
    },
    [surveyId],
  );

  useEffect(() => {
    const t = text.trim();
    if (t.length < MIN_CHARS || t === lastEvaluatedRef.current) return;
    const timer = setTimeout(() => void runEval(t), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, runEval]);

  const reset = useCallback(() => {
    setState(EMPTY);
    lastEvaluatedRef.current = "";
    pendingRef.current = null;
    setEvaluatedOnce(false);
  }, []);

  const items: BriefChecklistState[] = BRIEF_CHECKLIST.map((item) => ({ ...item, ...state[item.id] }));
  const satisfiedCount = items.filter((i) => i.satisfied).length;

  return {
    items,
    satisfiedCount,
    complete: satisfiedCount === items.length,
    evaluating,
    evaluatedOnce,
    reset,
  };
}

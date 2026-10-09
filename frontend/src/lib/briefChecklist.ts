/**
 * The five things a creator should cover when describing their research
 * agent. Ids and order MUST match `backend/src/services/brief.ts`, which
 * holds the TypeSafe Jev rubric that decides when each item gets its tick.
 */
export type BriefItemId = "audience" | "goal" | "purpose" | "tone" | "length";

export interface BriefChecklistItem {
  id: BriefItemId;
  label: string;
  hint: string;
}

export const BRIEF_CHECKLIST: BriefChecklistItem[] = [
  { id: "audience", label: "Who you'll talk to", hint: "e.g. customers who cancelled last quarter" },
  { id: "goal", label: "What you want to learn", hint: "the questions you most need answered" },
  { id: "purpose", label: "Why it matters", hint: "the decision the answers will feed" },
  { id: "tone", label: "How it should sound", hint: "warm, direct, playful, formal…" },
  { id: "length", label: "How long it should take", hint: "a number of questions or minutes" },
];

/** Tick an item at or above this probability… */
export const BRIEF_TICK_THRESHOLD = 0.7;
/** …and only untick it again if the model drops clearly below (hysteresis). */
export const BRIEF_UNTICK_THRESHOLD = 0.45;

/** Clarifying-question checkpoints: after the 2nd answer, then 5, 10, 15… */
export function isClarifyCheckpoint(answeredCount: number): boolean {
  return answeredCount === 2 || (answeredCount >= 5 && answeredCount % 5 === 0);
}

/** Hard stop: past this many clarifications we create the agent regardless. */
export const MAX_CLARIFICATIONS = 20;

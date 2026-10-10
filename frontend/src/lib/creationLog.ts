import { postCreationEvents, type CreationEventInput } from "@/api/client";

/**
 * Browser-side creation log → POST /api/surveys/:id/creation-events.
 *
 * Records the things only the browser sees while an agent is being created
 * (brief submitted with its tick timeline, follow-up answers, checkpoint
 * choices, review-screen edits) so the admin Creations tab can replay one
 * creation end to end. Fire-and-forget: events are batched for ~400 ms, sent
 * with `keepalive` so a navigation doesn't lose them, and never throw.
 * PostHog gets the same facts via trackEvent; this is the D1 copy.
 */

export type CreationEventKind =
  | "brief_submitted"
  | "clarify_answered"
  | "checkpoint"
  | "back"
  | "review_opened"
  | "review_edit"
  | "review_delete"
  | "review_add"
  | "review_reorder"
  | "review_confirm_tapped"
  | "regenerate";

const FLUSH_MS = 400;
const queues = new Map<string, CreationEventInput[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  for (const [surveyId, events] of queues) {
    if (events.length === 0) continue;
    queues.set(surveyId, []);
    void postCreationEvents(surveyId, events).catch(() => {
      // Analytics must never break the flow; a lost batch is acceptable.
    });
  }
}

export function logCreation(
  surveyId: string | null | undefined,
  kind: CreationEventKind,
  payload?: Record<string, unknown>,
  idx?: number,
): void {
  if (!surveyId) return;
  const list = queues.get(surveyId) ?? [];
  list.push({ kind, payload, idx, at: new Date().toISOString() });
  queues.set(surveyId, list);
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Send whatever is queued right now (used before leaving the page). */
export function flushCreationLog(): void {
  if (timer) clearTimeout(timer);
  flush();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushCreationLog);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushCreationLog();
  });
}

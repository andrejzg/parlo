/**
 * Per-survey creation log (D1 `creation_events`).
 *
 * The server writes what it knows first-hand (generation, judging, the
 * confirm diff); the browser posts what only it sees (brief submitted with
 * the tick timeline, follow-up answers, checkpoint choices, review edits)
 * through POST /api/surveys/:id/creation-events. The admin Creations tab
 * reads them back in order to tell the story of one creation.
 */

import { generateId } from "./codes";

export type CreationEventSource = "server" | "client";

export interface CreationEventInput {
  kind: string;
  idx?: number | null;
  payload?: unknown;
  /** Client-supplied timestamp (ISO); defaults to now. */
  at?: string;
}

export interface CreationEventRow {
  id: string;
  survey_id: string;
  kind: string;
  idx: number | null;
  payload: string | null;
  source: CreationEventSource;
  created_at: string;
}

export interface CreationEvent {
  id: string;
  kind: string;
  idx: number | null;
  payload: unknown;
  source: CreationEventSource;
  createdAt: string;
}

/** Kinds the browser is allowed to post. Everything else is server-only. */
export const CLIENT_EVENT_KINDS = new Set([
  "brief_submitted",
  "clarify_answered",
  "checkpoint",
  "back",
  "review_opened",
  "review_edit",
  "review_delete",
  "review_add",
  "review_reorder",
  "review_confirm_tapped",
  "regenerate",
]);

export const MAX_EVENTS_PER_POST = 50;
export const MAX_PAYLOAD_CHARS = 8_000;

export async function logCreationEvents(
  db: D1Database,
  surveyId: string,
  events: CreationEventInput[],
  source: CreationEventSource
): Promise<void> {
  if (events.length === 0) return;
  const stmts = events.map((e) =>
    db
      .prepare(
        "INSERT INTO creation_events (id, survey_id, kind, idx, payload, source, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))"
      )
      .bind(
        generateId(),
        surveyId,
        e.kind,
        e.idx ?? null,
        e.payload === undefined ? null : JSON.stringify(e.payload).slice(0, MAX_PAYLOAD_CHARS),
        source,
        e.at && !Number.isNaN(Date.parse(e.at)) ? new Date(e.at).toISOString().replace("T", " ").slice(0, 19) : null
      )
  );
  await db.batch(stmts);
}

export function logCreationEvent(
  db: D1Database,
  surveyId: string,
  kind: string,
  payload?: unknown,
  idx?: number | null
): Promise<void> {
  return logCreationEvents(db, surveyId, [{ kind, idx, payload }], "server");
}

export async function listCreationEvents(db: D1Database, surveyId: string): Promise<CreationEvent[]> {
  const rows = await db
    .prepare("SELECT * FROM creation_events WHERE survey_id = ? ORDER BY created_at ASC, rowid ASC")
    .bind(surveyId)
    .all<CreationEventRow>();
  return rows.results.map(parseRow);
}

export function parseRow(r: CreationEventRow): CreationEvent {
  let payload: unknown = null;
  if (r.payload) {
    try {
      payload = JSON.parse(r.payload);
    } catch {
      payload = r.payload;
    }
  }
  return { id: r.id, kind: r.kind, idx: r.idx, payload, source: r.source, createdAt: r.created_at };
}

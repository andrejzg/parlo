/**
 * The home screen's parlo list is a chat-style inbox: newest activity first,
 * each row carrying what just happened (the open round and how many have
 * answered it, a proposal waiting on the owner, a few faces, the first line
 * of the agent's report). These helpers shape that for `GET /api/my/surveys`.
 */

import { displayNameFor } from "./groups";

/**
 * D1 writes `datetime('now')` as "YYYY-MM-DD HH:MM:SS" (UTC, no zone) while
 * the Worker writes ISO strings. Browsers parse the former as *local* time,
 * so everything the list returns goes through here and comes out as ISO.
 */
export function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function toIso(value: string | null | undefined): string | null {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/** The latest of several timestamps, as ISO; null when none parse. */
export function latestOf(values: (string | null | undefined)[]): string | null {
  let best: number | null = null;
  for (const v of values) {
    const ms = toMs(v);
    if (ms !== null && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * First line of prose from the agent's report, for the row preview. Skips
 * headings, rules and tables, strips inline markdown, caps at `max` chars
 * on a word boundary.
 */
export function reportPreview(markdown: string | null | undefined, max = 160): string | null {
  if (!markdown) return null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(#{1,6}\s|---|\*\*\*|\||```|>)/.test(line)) continue;
    const text = line
      .replace(/^([-*+]|\d+[.)])\s+/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const atWord = cut.lastIndexOf(" ");
    return `${(atWord > max * 0.6 ? cut.slice(0, atWord) : cut).replace(/[,;:\s]+$/, "")}…`;
  }
  return null;
}

/** Run many statements in one round trip, chunked to stay well inside D1's batch limits. */
export async function batchAll<T = Record<string, unknown>>(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
  const out: D1Result<T>[] = [];
  const size = 60;
  for (let i = 0; i < statements.length; i += size) {
    out.push(...(await db.batch<T>(statements.slice(i, i + size))));
  }
  return out;
}

export interface OpenRoundRow {
  id: string;
  number: number;
  kind: "poll" | "probe";
  sent_at: string | null;
  closes_at: string | null;
  /** Distinct members a probe round is aimed at (0 for a poll). */
  targeted: number;
  /** Distinct people who answered at least one ask in this round. */
  answered: number;
}

/** The latest sent round, with how many it reached and how many answered. */
export function openRoundStmt(db: D1Database, surveyId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT r.id, r.number, r.kind, r.sent_at, r.closes_at,
        (SELECT COUNT(DISTINCT sq.target_user_id) FROM survey_questions sq
          WHERE sq.round_id = r.id AND sq.target_user_id IS NOT NULL) AS targeted,
        (SELECT COUNT(DISTINCT COALESCE(resp.user_id, resp.id)) FROM response_answers ra
          JOIN responses resp ON resp.id = ra.response_id
          JOIN survey_questions sq ON sq.id = ra.question_id
          WHERE sq.round_id = r.id AND resp.status != 'in_progress') AS answered
       FROM rounds r
       WHERE r.survey_id = ? AND r.status = 'sent'
       ORDER BY r.number DESC LIMIT 1`
    )
    .bind(surveyId);
}

export interface ProposedRoundRow {
  number: number;
  kind: "poll" | "probe";
  created_at: string;
}

export function proposedRoundStmt(db: D1Database, surveyId: string): D1PreparedStatement {
  return db
    .prepare("SELECT number, kind, created_at FROM rounds WHERE survey_id = ? AND status = 'proposed' ORDER BY number DESC LIMIT 1")
    .bind(surveyId);
}

export interface FaceRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  wa_name: string | null;
  linkedin_name: string | null;
  phone: string | null;
  has_photo: number;
}

/**
 * Up to three other members for the avatar cluster: people with a photo
 * first, then the most recent joiners. Never the viewer themself.
 */
export function facesStmt(db: D1Database, surveyId: string, viewerId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone,
        (u.linkedin_photo_r2_key IS NOT NULL OR u.linkedin_photo_url IS NOT NULL) AS has_photo
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.survey_id = ? AND gm.removed_at IS NULL AND gm.user_id != ?
       ORDER BY has_photo DESC, gm.joined_at DESC
       LIMIT 3`
    )
    .bind(surveyId, viewerId);
}

export interface Face {
  userId: string;
  name: string | null;
  photoUrl: string | null;
}

export function toFace(row: FaceRow, baseUrl: string): Face {
  return {
    userId: row.id,
    name: displayNameFor(row),
    photoUrl: row.has_photo ? `${baseUrl}/api/users/${row.id}/photo` : null,
  };
}

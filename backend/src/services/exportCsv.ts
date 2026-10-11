/**
 * The answers table as CSV: one row per answer, used by the owner's download
 * and handed to the agent when it exports to a connected destination.
 */
import { displayNameFor } from "./groups";

export const ANSWERS_CSV_COLUMNS = [
  "round",
  "member",
  "question",
  "kind",
  "answer",
  "answered_at",
  "duration_seconds",
  "response_id",
] as const;

interface AnswerRow {
  response_id: string;
  submitted_at: string | null;
  response_first_name: string | null;
  response_last_name: string | null;
  first_name: string | null;
  last_name: string | null;
  wa_name: string | null;
  linkedin_name: string | null;
  question: string;
  question_type: string | null;
  round_number: number | null;
  transcription: string | null;
  transcription_status: string | null;
  duration_ms: number | null;
  image_r2_key: string | null;
  video_r2_key: string | null;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** SQLite's `datetime('now')` has no zone; make it unambiguous (pitfall 25). */
function toIsoish(s: string | null): string {
  if (!s) return "";
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(" ", "T")}Z` : s;
}

function answerText(r: AnswerRow): string {
  const t = r.transcription?.trim();
  if (t) return t;
  if (r.image_r2_key) return "(photo)";
  if (r.transcription_status === "pending") return r.video_r2_key ? "(video — transcript pending)" : "(transcript pending)";
  if (r.transcription_status === "failed") return r.video_r2_key ? "(video — no speech transcribed)" : "(no speech transcribed)";
  return "";
}

export async function buildAnswersCsv(db: D1Database, surveyId: string): Promise<string> {
  const rows = await db
    .prepare(
      `SELECT r.id AS response_id, r.submitted_at,
              r.first_name AS response_first_name, r.last_name AS response_last_name,
              u.first_name, u.last_name, u.wa_name, u.linkedin_name,
              q.text AS question, q.question_type, rd.number AS round_number,
              a.transcription, a.transcription_status, a.duration_ms, a.image_r2_key, a.video_r2_key
       FROM response_answers a
       JOIN responses r ON r.id = a.response_id
       JOIN survey_questions q ON q.id = a.question_id
       LEFT JOIN rounds rd ON rd.id = q.round_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.survey_id = ? AND r.status != 'in_progress'
       ORDER BY COALESCE(rd.number, 1) ASC, r.submitted_at ASC, q.sort_order ASC`
    )
    .bind(surveyId)
    .all<AnswerRow>();

  const lines: string[] = [ANSWERS_CSV_COLUMNS.join(",")];
  for (const r of rows.results) {
    const member =
      displayNameFor({
        first_name: r.first_name ?? r.response_first_name,
        last_name: r.last_name ?? r.response_last_name,
        wa_name: r.wa_name,
        linkedin_name: r.linkedin_name,
        phone: null,
      }) ?? "Anonymous";
    lines.push(
      [
        r.round_number ?? 1,
        member,
        r.question,
        r.question_type ?? "voice",
        answerText(r),
        toIsoish(r.submitted_at),
        r.duration_ms ? Math.round(r.duration_ms / 1000) : "",
        r.response_id,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

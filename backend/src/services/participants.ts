/**
 * Bringing participants into a study before they answer anything here.
 *
 * A researcher imports the people a study will talk to: a name, a phone or
 * an email when there is one, the segment they belong to ("Customer",
 * "Competitor user") and, when they were already interviewed elsewhere, the
 * transcript of that interview. Each becomes a participant with a personal
 * link. That link is what makes them payable (services/rewards.ts) and what
 * lets the agent follow up with them by name.
 *
 * An imported transcript is filed as round 0, closed: the agent reads it
 * like any other answer, and nobody is asked it again.
 */

import { asPublishConsent, type Env, type PublishConsent, type Survey } from "../types";
import { generateCode, generateId } from "./codes";
import { displayNameFor, ensureMember, findUserByPhone } from "./groups";
import { normalizePhone } from "./phone";
import { ingestIntoAgent } from "./transcription";

export interface ParticipantInput {
  name?: string;
  phone?: string;
  email?: string;
  segment?: string;
  descriptor?: string;
  transcript?: string;
  /** What this person agreed to when the imported interview was held: none (default) | quote | voice. */
  publishConsent?: string;
}

export interface ImportedParticipant {
  userId: string;
  name: string | null;
  segment: string | null;
  /** The personal link to send them. */
  link: string;
  added: boolean;
  transcriptImported: boolean;
}

export const MAX_IMPORT = 200;
/** The agent reads an answer file up to 6,000 characters, so a long interview is filed in parts. */
const TRANSCRIPT_PART_CHARS = 5500;
const MAX_TRANSCRIPT_CHARS = 120_000;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/\s+/g, " ");
  return v ? v.slice(0, max) : null;
}

function splitName(name: string | null): { first: string | null; last: string | null } {
  if (!name) return { first: null, last: null };
  const parts = name.split(" ");
  return { first: parts[0] ?? null, last: parts.slice(1).join(" ") || null };
}

function validEmail(email: string | null): string | null {
  if (!email) return null;
  const e = email.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Cut a transcript into parts at paragraph, then sentence, boundaries. */
export function splitTranscript(text: string, max = TRANSCRIPT_PART_CHARS): string[] {
  const parts: string[] = [];
  let rest = text.trim().slice(0, MAX_TRANSCRIPT_CHARS);
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max * 0.5) cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! ")) + 1;
    if (cut < max * 0.5) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Round 0, closed, holding one ask per transcript part. Returns the ask ids, in order. */
async function importAsks(db: D1Database, surveyId: string, parts: number): Promise<string[]> {
  let round = await db.prepare("SELECT id FROM rounds WHERE survey_id = ? AND number = 0").bind(surveyId).first<{ id: string }>();
  if (!round) {
    const id = generateId();
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT OR IGNORE INTO rounds (id, survey_id, number, kind, status, rationale, proposed_by, sent_at, closed_at)
         VALUES (?, ?, 0, 'poll', 'closed', 'Interviews held before the study opened here, imported as transcripts.', 'import', ?, ?)`
      )
      .bind(id, surveyId, now, now)
      .run();
    round = (await db.prepare("SELECT id FROM rounds WHERE survey_id = ? AND number = 0").bind(surveyId).first<{ id: string }>()) as { id: string };
  }
  const existing = await db.prepare("SELECT id FROM survey_questions WHERE round_id = ? ORDER BY sort_order ASC").bind(round.id).all<{ id: string }>();
  const ids = existing.results.map((r) => r.id);
  for (let i = ids.length; i < parts; i++) {
    const id = generateId();
    await db
      .prepare("INSERT INTO survey_questions (id, survey_id, sort_order, text, hint, question_type, round_id) VALUES (?, ?, ?, ?, NULL, 'voice', ?)")
      // Negative sort order keeps imported parts ahead of round 1 wherever asks are listed by sort order.
      .bind(id, surveyId, i - 1000, i === 0 ? "The interview (imported transcript)" : `The interview, continued (part ${i + 1})`, round.id)
      .run();
    ids.push(id);
  }
  return ids.slice(0, parts);
}

async function importTranscript(env: Env, survey: Survey, userId: string, name: string | null, transcript: string, publish: PublishConsent): Promise<boolean> {
  const db = env.DB;
  const already = await db
    .prepare(
      `SELECT 1 FROM responses r JOIN rounds rd ON rd.id = r.round_id
       WHERE r.survey_id = ? AND r.user_id = ? AND rd.number = 0 AND r.status != 'in_progress' LIMIT 1`
    )
    .bind(survey.id, userId)
    .first();
  if (already) return false;
  const parts = splitTranscript(transcript);
  if (parts.length === 0) return false;
  const askIds = await importAsks(db, survey.id, parts.length);
  const round = (await db.prepare("SELECT id FROM rounds WHERE survey_id = ? AND number = 0").bind(survey.id).first<{ id: string }>()) as { id: string };
  const responseId = generateId();
  const { first, last } = splitName(name);
  await db.batch([
    db
      .prepare(
        `INSERT INTO responses (id, code, survey_id, user_id, round_id, first_name, last_name, status, submitted_at, visibility_at_submit, sponsor_consent, publish_consent)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', datetime('now'), ?, ?, ?)`
      )
      .bind(responseId, generateCode(10), survey.id, userId, round.id, first, last, survey.visibility === "open" ? "open" : "private", survey.sponsor_name ? 1 : 0, publish),
    ...parts.map((text, i) =>
      db
        .prepare("INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, duration_ms, transcription, transcription_status) VALUES (?, ?, ?, '', 0, ?, 'completed')")
        .bind(generateId(), responseId, askIds[i], text)
    ),
  ]);
  await ingestIntoAgent(env, responseId).catch((err) => console.error(`[participants] agent ingest failed for ${responseId}:`, err));
  return true;
}

export async function importParticipants(
  env: Env,
  survey: Survey,
  actorId: string,
  inputs: ParticipantInput[]
): Promise<{ participants: ImportedParticipant[]; skipped: { row: number; reason: string }[] }> {
  const db = env.DB;
  const origin = (env.FRONTEND_ORIGIN ?? "https://parlo.me").replace(/\/+$/, "");
  const participants: ImportedParticipant[] = [];
  const skipped: { row: number; reason: string }[] = [];
  // Bringing named participants in is what makes a parlo a study.
  await db.prepare("UPDATE surveys SET kind = 'study' WHERE id = ? AND kind IS NULL").bind(survey.id).run();

  for (const [index, raw] of inputs.slice(0, MAX_IMPORT).entries()) {
    const name = clean(raw.name, 120);
    const email = validEmail(clean(raw.email, 200));
    const phoneRaw = clean(raw.phone, 40);
    const phone = phoneRaw && phoneRaw.replace(/\D/g, "").length >= 7 ? normalizePhone(phoneRaw) : null;
    const segment = clean(raw.segment, 60);
    const descriptor = clean(raw.descriptor, 200);
    if (!name && !email && !phone) {
      skipped.push({ row: index + 1, reason: "Needs a name, a phone number or an email" });
      continue;
    }

    // Find them: by phone, then by email; else a new user.
    let userId = phone ? (await findUserByPhone(db, phone))?.id ?? null : null;
    if (!userId && email) userId = (await db.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first<{ id: string }>())?.id ?? null;
    const { first, last } = splitName(name);
    if (!userId) {
      userId = generateId();
      await db.prepare("INSERT INTO users (id, phone, email, first_name, last_name) VALUES (?, ?, ?, ?, ?)").bind(userId, phone, email, first, last).run();
    } else {
      await db
        .prepare("UPDATE users SET first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?), email = COALESCE(email, ?) WHERE id = ?")
        .bind(first, last, email, userId)
        .run();
    }

    const membership = await ensureMember(db, survey.id, userId, "member", actorId);
    if (membership.role !== "member") {
      skipped.push({ row: index + 1, reason: "Already on the study's team" });
      continue;
    }
    if (membership.removed_at) {
      skipped.push({ row: index + 1, reason: "Was removed from this study" });
      continue;
    }
    if (segment || descriptor) {
      await db
        .prepare("UPDATE group_members SET segment = COALESCE(?, segment), descriptor = COALESCE(?, descriptor) WHERE survey_id = ? AND user_id = ?")
        .bind(segment, descriptor, survey.id, userId)
        .run();
    }

    const transcript = typeof raw.transcript === "string" && raw.transcript.trim().length > 40 ? raw.transcript : null;
    const transcriptImported = transcript ? await importTranscript(env, survey, userId, name, transcript, asPublishConsent(raw.publishConsent)) : false;

    const user = await db
      .prepare("SELECT first_name, last_name, wa_name, linkedin_name, phone FROM users WHERE id = ?")
      .bind(userId)
      .first<{ first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null }>();
    participants.push({
      userId,
      name: (user && displayNameFor(user)) || name,
      segment: segment ?? membership.segment ?? null,
      link: `${origin}/s/${survey.code}?t=${membership.access_token}`,
      added: membership.created,
      transcriptImported,
    });
  }
  return { participants, skipped };
}

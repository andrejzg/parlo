/**
 * Rounds: the agent's turns. Round 1 is the original question set the
 * creator built. Later rounds are proposed by the group agent (or the
 * owner), approved at round level, then "sent". Each ask is a
 * `survey_questions` row with a `round_id`, targeted at everyone
 * (`target_user_id` NULL, a poll) or at one member (a probe).
 */

import type { Env, Round, RoundKind, SurveyQuestion } from "../types";
import { generateId } from "./codes";
import { notifyUsers } from "./notify";
import { createWhatsAppClient } from "./whatsapp";
import { closesAtFor } from "./shapes";

export async function ensureRound1(db: D1Database, surveyId: string): Promise<Round> {
  const existing = await db
    .prepare("SELECT * FROM rounds WHERE survey_id = ? AND number = 1")
    .bind(surveyId)
    .first<Round>();
  if (existing) return existing;
  const id = generateId();
  const survey = await db.prepare("SELECT created_at FROM surveys WHERE id = ?").bind(surveyId).first<{ created_at: string }>();
  await db
    .prepare(
      "INSERT OR IGNORE INTO rounds (id, survey_id, number, kind, status, proposed_by, created_at, sent_at) VALUES (?, ?, 1, 'poll', 'sent', 'creator', ?, ?)"
    )
    .bind(id, surveyId, survey?.created_at ?? new Date().toISOString(), survey?.created_at ?? new Date().toISOString())
    .run();
  return (await db.prepare("SELECT * FROM rounds WHERE survey_id = ? AND number = 1").bind(surveyId).first<Round>()) as Round;
}

export async function getRound(db: D1Database, roundId: string): Promise<Round | null> {
  return db.prepare("SELECT * FROM rounds WHERE id = ?").bind(roundId).first<Round>();
}

export async function listRounds(db: D1Database, surveyId: string): Promise<Round[]> {
  const r = await db.prepare("SELECT * FROM rounds WHERE survey_id = ? ORDER BY number ASC").bind(surveyId).all<Round>();
  return r.results;
}

export async function latestSentRound(db: D1Database, surveyId: string): Promise<Round | null> {
  return db
    .prepare("SELECT * FROM rounds WHERE survey_id = ? AND status = 'sent' ORDER BY number DESC LIMIT 1")
    .bind(surveyId)
    .first<Round>();
}

export async function proposedRound(db: D1Database, surveyId: string): Promise<Round | null> {
  return db
    .prepare("SELECT * FROM rounds WHERE survey_id = ? AND status = 'proposed' ORDER BY number DESC LIMIT 1")
    .bind(surveyId)
    .first<Round>();
}

export async function roundAsks(db: D1Database, roundId: string): Promise<SurveyQuestion[]> {
  const r = await db
    .prepare("SELECT * FROM survey_questions WHERE round_id = ? ORDER BY sort_order ASC")
    .bind(roundId)
    .all<SurveyQuestion>();
  return r.results;
}

/**
 * The asks still pending for a visitor: every ask in a sent round that is
 * aimed at everyone (or at this user), minus the ones this user has already
 * answered in a submitted response. Anonymous visitors (no user) get all
 * "everyone" asks from every sent round.
 */
export async function pendingAsksFor(db: D1Database, surveyId: string, userId: string | null): Promise<SurveyQuestion[]> {
  if (!userId) {
    const r = await db
      .prepare(
        `SELECT q.* FROM survey_questions q
         JOIN rounds r ON r.id = q.round_id
         WHERE q.survey_id = ? AND r.status = 'sent' AND q.target_user_id IS NULL
         ORDER BY r.number ASC, q.sort_order ASC`
      )
      .bind(surveyId)
      .all<SurveyQuestion>();
    return r.results;
  }
  const r = await db
    .prepare(
      `SELECT q.* FROM survey_questions q
       JOIN rounds r ON r.id = q.round_id
       WHERE q.survey_id = ? AND r.status = 'sent'
         AND (q.target_user_id IS NULL OR q.target_user_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM response_answers ra
           JOIN responses resp ON resp.id = ra.response_id
           WHERE ra.question_id = q.id AND resp.user_id = ? AND resp.status != 'in_progress'
         )
       ORDER BY r.number ASC, q.sort_order ASC`
    )
    .bind(surveyId, userId, userId)
    .all<SurveyQuestion>();
  return r.results;
}

export interface ProposedAsk {
  text: string;
  hint?: string | null;
  type?: "voice" | "photo" | "video";
  targetUserId?: string | null;
}

/** Create a proposed round with its asks. Replaces any earlier still-proposed round. */
export async function createProposedRound(
  db: D1Database,
  surveyId: string,
  input: { kind: RoundKind; rationale: string | null; proposedBy: string; asks: ProposedAsk[] }
): Promise<{ round: Round; asks: SurveyQuestion[] }> {
  if (input.asks.length === 0) throw new Error("A round needs at least one ask");

  const stale = await db
    .prepare("SELECT id FROM rounds WHERE survey_id = ? AND status = 'proposed'")
    .bind(surveyId)
    .all<{ id: string }>();
  const cleanup: D1PreparedStatement[] = [];
  for (const s of stale.results) {
    cleanup.push(db.prepare("DELETE FROM survey_questions WHERE round_id = ?").bind(s.id));
    cleanup.push(db.prepare("DELETE FROM rounds WHERE id = ?").bind(s.id));
  }

  const maxRow = await db
    .prepare("SELECT COALESCE(MAX(number), 0) AS n FROM rounds WHERE survey_id = ? AND status != 'rejected'")
    .bind(surveyId)
    .first<{ n: number }>();
  const number = (maxRow?.n ?? 0) + 1;
  const roundId = generateId();

  const inserts: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO rounds (id, survey_id, number, kind, status, rationale, proposed_by) VALUES (?, ?, ?, ?, 'proposed', ?, ?)")
      .bind(roundId, surveyId, number, input.kind, input.rationale, input.proposedBy),
  ];
  input.asks.forEach((a, i) => {
    const qType = a.type === "photo" ? "photo" : a.type === "video" ? "video" : "voice";
    inserts.push(
      db
        .prepare(
          "INSERT INTO survey_questions (id, survey_id, sort_order, text, hint, question_type, round_id, target_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(generateId(), surveyId, i + 1, a.text, a.hint ?? null, qType, roundId, a.targetUserId ?? null)
    );
  });

  await db.batch([...cleanup, ...inserts]);
  const round = (await getRound(db, roundId)) as Round;
  return { round, asks: await roundAsks(db, roundId) };
}

export async function setRoundStatus(db: D1Database, roundId: string, status: "sent" | "rejected" | "closed"): Promise<void> {
  await db
    .prepare(`UPDATE rounds SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END WHERE id = ?`)
    .bind(status, status, roundId)
    .run();
}

export interface SendRoundResult {
  round: Round;
  recipients: { user_id: string; access_token: string; phone: string | null }[];
  closesAt: Date | null;
}

/**
 * Send a proposed round: status `sent`, the deadline from `surveys.timing`,
 * an Inbox line and the `parlo_new_round` WhatsApp template (personal link)
 * to every member for a poll (minus `exceptUserId`, the owner who approved
 * it), only the targeted members for a probe. Shared by the approve route
 * and the agent, which sends the next check-in round itself. The caller
 * schedules the agent's close alarm (`scheduleClose`) from the returned
 * `closesAt`; WhatsApp sends run inside `sendMessages` so the caller can
 * `waitUntil` them.
 */
export async function sendRound(
  env: Env,
  survey: { id: string; code: string; title: string | null; timing?: string | null },
  round: Round,
  asks: SurveyQuestion[],
  exceptUserId: string | null
): Promise<SendRoundResult & { sendMessages: () => Promise<void> }> {
  await setRoundStatus(env.DB, round.id, "sent");
  const closesAt = closesAtFor(survey.timing);
  await setRoundClosesAt(env.DB, round.id, closesAt);

  const targets = round.kind === "probe" ? new Set(asks.map((a) => a.target_user_id).filter((x): x is string => !!x)) : null;
  const members = await env.DB.prepare(
    `SELECT gm.user_id, gm.access_token, u.phone FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.survey_id = ? AND gm.removed_at IS NULL`
  )
    .bind(survey.id)
    .all<{ user_id: string; access_token: string; phone: string | null }>();
  const recipients = members.results.filter((m) => m.user_id !== exceptUserId && (!targets || targets.has(m.user_id)));

  const title = survey.title ?? "your parlo";
  await notifyUsers(
    env.DB,
    recipients.map((r) => r.user_id),
    {
      type: "new_round",
      title: round.kind === "probe" ? `The agent has a follow-up question for you in ${title}` : `Round ${round.number} of ${title} is open`,
      body: asks[0]?.text ?? null,
      surveyId: survey.id,
      surveyTitle: survey.title,
    }
  );

  // WhatsApp: template `parlo_new_round` (body: survey_title, round_number;
  // URL button suffix: "<code>?t=<token>"). Sends are fire-and-forget.
  const wa = createWhatsAppClient(env.KAPSO_API_KEY, env.WHATSAPP_PHONE_NUMBER_ID);
  const sendMessages = async () => {
    for (const r of recipients) {
      if (!r.phone) continue;
      try {
        await wa.sendTemplate(r.phone, "parlo_new_round", [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "survey_title", text: title },
              { type: "text", parameter_name: "round_number", text: String(round.number) },
            ],
          },
          { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: `${survey.code}?t=${r.access_token}` }] },
        ]);
      } catch (err) {
        console.error("[rounds] WhatsApp send failed", err);
      }
    }
  };

  return { round: (await getRound(env.DB, round.id)) as Round, recipients, closesAt, sendMessages };
}

/** Set (or clear) when a sent round stops taking answers. */
export async function setRoundClosesAt(db: D1Database, roundId: string, closesAt: Date | null): Promise<void> {
  await db.prepare("UPDATE rounds SET closes_at = ? WHERE id = ?").bind(closesAt ? closesAt.toISOString() : null, roundId).run();
}

/** Close a sent round: no more answers; the report lands. Returns false when it was not open. */
export async function closeRound(db: D1Database, roundId: string): Promise<boolean> {
  const r = await db
    .prepare("UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'sent'")
    .bind(new Date().toISOString(), roundId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Sent rounds whose deadline has passed and that never closed (a lost alarm). */
export async function overdueRounds(db: D1Database, surveyId: string): Promise<Round[]> {
  const r = await db
    .prepare("SELECT * FROM rounds WHERE survey_id = ? AND status = 'sent' AND closes_at IS NOT NULL AND closes_at < ?")
    .bind(surveyId, new Date().toISOString())
    .all<Round>();
  return r.results;
}

export interface PendingMember {
  user_id: string;
  access_token: string;
  phone: string | null;
}

/**
 * The members a sent round is still waiting on: for a poll every active
 * member but the owner (who asked), for a probe the members it was aimed at,
 * minus anyone with a submitted answer to one of the round's asks.
 */
export async function membersPendingFor(db: D1Database, surveyId: string, round: Round): Promise<PendingMember[]> {
  const r = await db
    .prepare(
      `SELECT gm.user_id, gm.access_token, u.phone FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.survey_id = ? AND gm.removed_at IS NULL
         AND (? = 'probe' OR gm.role != 'owner')
         AND (? = 'poll' OR EXISTS (SELECT 1 FROM survey_questions q WHERE q.round_id = ? AND q.target_user_id = gm.user_id))
         AND NOT EXISTS (
           SELECT 1 FROM response_answers ra
           JOIN responses resp ON resp.id = ra.response_id
           JOIN survey_questions q ON q.id = ra.question_id
           WHERE q.round_id = ? AND resp.user_id = gm.user_id AND resp.status != 'in_progress'
         )`
    )
    .bind(surveyId, round.kind, round.kind, round.id, round.id)
    .all<PendingMember>();
  return r.results;
}

/** Owner edits to a proposed round's ask texts before approving. */
export async function updateRoundAsks(db: D1Database, roundId: string, edits: { id: string; text: string; hint?: string | null }[]): Promise<void> {
  const statements = edits
    .filter((e) => e.id && typeof e.text === "string" && e.text.trim())
    .map((e) =>
      db
        .prepare("UPDATE survey_questions SET text = ?, hint = COALESCE(?, hint) WHERE id = ? AND round_id = ?")
        .bind(e.text.trim().slice(0, 1000), e.hint ?? null, e.id, roundId)
    );
  if (statements.length) await db.batch(statements);
}

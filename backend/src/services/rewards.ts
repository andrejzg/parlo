/**
 * Rewards: paying a participant for a touch.
 *
 * A round carries a price (`rounds.reward_cents`), a study a cap
 * (`surveys.reward_budget_cents`). The ledger (`rewards`) holds one row per
 * member per round, so nobody is paid twice for the same round. The money
 * itself moves through a provider (`services/tremendous.ts`); this file is
 * everything around it.
 *
 *   pending  → the answer is in, its transcript is not
 *   held     → a researcher has to look: too short, off topic, over budget
 *   approved → owed; the provider has not been asked yet (or is not connected)
 *   sent     → the provider holds it; the member claims it by link
 *   failed   → the provider refused; `error` says why, a researcher retries
 *   void     → cancelled by a researcher
 *
 * Who is paid: a participant (`role = 'member'`) who was already in the
 * study before this answer, that is, someone who arrived by a personal
 * link. An answer that came in over the open share link joins the group and
 * is never paid for that touch: a paid open link is a fraud magnet.
 */

import type { Env, Round } from "../types";
import { generateId } from "./codes";
import { displayNameFor } from "./groups";
import { trackServerEvent } from "./analytics";
import { systemOne } from "./typesafe";
import { createLinkReward, generateRewardLink, tremendousConfigured, tremendousMode, TremendousError } from "./tremendous";

export type RewardStatus = "pending" | "held" | "approved" | "sent" | "failed" | "void";
export type HoldReason = "too_short" | "off_topic" | "over_budget";

export interface RewardRow {
  id: string;
  survey_id: string;
  round_id: string;
  user_id: string;
  response_id: string;
  amount_cents: number;
  currency: string;
  status: RewardStatus;
  hold_reason: HoldReason | null;
  provider: string | null;
  provider_order_id: string | null;
  provider_reward_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  claimed_at: string | null;
}

/** A spoken answer shorter than this is not an answer. */
const MIN_WORDS = 8;
/** TypeSafe's probability that the answer is in earnest; below this a person looks. */
const OFF_TOPIC_BELOW = 0.35;
export const MAX_REWARD_CENTS = 50_000;

export function sanitizeCents(value: unknown, max = MAX_REWARD_CENTS): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(max, Math.round(n));
}

export class RewardError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 | 502 = 400) {
    super(message);
  }
}

// ── Money maths ────────────────────────────────────────────────────────

/** Money already promised: paid, owed, or waiting on a transcript. Held, failed and void rows are not. */
export async function committedCents(db: D1Database, surveyId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM rewards WHERE survey_id = ? AND status IN ('pending', 'approved', 'sent')")
    .bind(surveyId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** How many participants a round can pay: every participant for a poll, the ones it is aimed at for a probe. */
export async function paidReach(db: D1Database, surveyId: string, round: Pick<Round, "id" | "kind">): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM group_members gm
       WHERE gm.survey_id = ? AND gm.removed_at IS NULL AND gm.role = 'member'
         AND (? = 'poll' OR EXISTS (SELECT 1 FROM survey_questions q WHERE q.round_id = ? AND q.target_user_id = gm.user_id))`
    )
    .bind(surveyId, round.kind, round.id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface RoundCost {
  rewardCents: number;
  reach: number;
  /** What the round costs if everyone it reaches answers. */
  maxCents: number;
  budgetCents: number | null;
  committedCents: number;
  /** Budget minus what is promised; null without a budget. */
  remainingCents: number | null;
  fits: boolean;
}

export async function roundCost(
  db: D1Database,
  survey: { id: string; reward_budget_cents?: number | null },
  round: Pick<Round, "id" | "kind" | "reward_cents">
): Promise<RoundCost> {
  const rewardCents = round.reward_cents ?? 0;
  const [reach, committed] = await Promise.all([paidReach(db, survey.id, round), committedCents(db, survey.id)]);
  const maxCents = rewardCents * reach;
  const budgetCents = survey.reward_budget_cents ?? null;
  const remainingCents = budgetCents === null ? null : budgetCents - committed;
  return {
    rewardCents,
    reach,
    maxCents,
    budgetCents,
    committedCents: committed,
    remainingCents,
    fits: rewardCents === 0 || remainingCents === null || maxCents <= remainingCents,
  };
}

// ── What a participant is offered ──────────────────────────────────────

/**
 * What answering now would pay this member: the price of every paid round
 * that still has an ask waiting for them. Null for anyone who is not already
 * a participant of this study.
 */
export async function rewardOfferFor(
  db: D1Database,
  survey: { id: string; reward_currency?: string | null },
  member: { user_id: string; role: string } | null
): Promise<{ amountCents: number; currency: string } | null> {
  if (!member || member.role !== "member") return null;
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(r.reward_cents), 0) AS n FROM rounds r
       WHERE r.survey_id = ? AND r.status = 'sent' AND r.reward_cents > 0
         AND NOT EXISTS (SELECT 1 FROM rewards w WHERE w.round_id = r.id AND w.user_id = ?)
         AND EXISTS (
           SELECT 1 FROM survey_questions q
           WHERE q.round_id = r.id AND (q.target_user_id IS NULL OR q.target_user_id = ?)
             AND NOT EXISTS (
               SELECT 1 FROM response_answers ra JOIN responses resp ON resp.id = ra.response_id
               WHERE ra.question_id = q.id AND resp.user_id = ? AND resp.status != 'in_progress'
             )
         )`
    )
    .bind(survey.id, member.user_id, member.user_id, member.user_id)
    .first<{ n: number }>();
  const amountCents = row?.n ?? 0;
  return amountCents > 0 ? { amountCents, currency: survey.reward_currency || "USD" } : null;
}

// ── From an answer to a ledger row ─────────────────────────────────────

/**
 * Called at submit. `wasParticipant` is whether the person was already a
 * participant of the study before this response (see the header). One
 * `pending` row per paid round the response answered.
 */
export async function createRewardsForResponse(
  env: Env,
  response: { id: string; survey_id: string },
  userId: string | null,
  wasParticipant: boolean
): Promise<number> {
  if (!userId || !wasParticipant) return 0;
  const db = env.DB;
  const rounds = await db
    .prepare(
      `SELECT DISTINCT r.id, r.reward_cents, s.reward_currency FROM response_answers ra
       JOIN survey_questions q ON q.id = ra.question_id
       JOIN rounds r ON r.id = q.round_id
       JOIN surveys s ON s.id = r.survey_id
       WHERE ra.response_id = ? AND r.reward_cents > 0`
    )
    .bind(response.id)
    .all<{ id: string; reward_cents: number; reward_currency: string | null }>();
  let created = 0;
  for (const r of rounds.results) {
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO rewards (id, survey_id, round_id, user_id, response_id, amount_cents, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .bind(generateId(), response.survey_id, r.id, userId, response.id, r.reward_cents, r.reward_currency || "USD")
      .run();
    if ((res.meta?.changes ?? 0) > 0) {
      created++;
      trackServerEvent(userId, "reward_created", { surveyId: response.survey_id, roundId: r.id, amountCents: r.reward_cents });
    }
  }
  return created;
}

type Verdict = { kind: "wait" } | { kind: "pass" } | { kind: "hold"; reason: HoldReason };

/** Is this an answer worth paying for? Deterministic floor first, then a typed judgment when TypeSafe is set. */
async function judge(env: Env, reward: RewardRow): Promise<Verdict> {
  const answers = await env.DB
    .prepare(
      `SELECT ra.transcription, ra.transcription_status, ra.image_r2_key, q.text, q.question_type
       FROM response_answers ra JOIN survey_questions q ON q.id = ra.question_id
       WHERE ra.response_id = ? AND q.round_id = ?`
    )
    .bind(reward.response_id, reward.round_id)
    .all<{ transcription: string | null; transcription_status: string; image_r2_key: string | null; text: string; question_type: string }>();
  if (answers.results.length === 0) return { kind: "hold", reason: "too_short" };
  if (answers.results.some((a) => a.transcription_status === "pending")) return { kind: "wait" };

  const spoken = answers.results.filter((a) => a.question_type !== "photo");
  if (spoken.length > 0) {
    const words = spoken.reduce((n, a) => n + (a.transcription?.trim().split(/\s+/).filter(Boolean).length ?? 0), 0);
    if (words < MIN_WORDS) return { kind: "hold", reason: "too_short" };

    if (env.TYPESAFE_API_KEY) {
      try {
        const result = await systemOne(
          env.TYPESAFE_API_KEY,
          {
            context: "A research participant answered by voice. These are the questions they were asked and the transcripts of what they said.",
            answers: spoken.map((a) => ({ question: a.text, transcript: (a.transcription ?? "").slice(0, 3000) })),
          },
          {
            earnest: {
              type: "noul",
              instructions: "Did the participant give a real answer to what they were asked?",
              criteria: {
                true: "They speak to the question in their own words, even briefly or critically.",
                false: "Silence, noise, a test phrase, a refusal, unrelated talk, or text read out that has nothing to do with the question.",
              },
            },
          },
          { timeoutMs: 5000, properties: { purpose: "reward-gate", rewardId: reward.id } }
        );
        if ((result.answers.earnest?.noul ?? 1) < OFF_TOPIC_BELOW) return { kind: "hold", reason: "off_topic" };
      } catch (err) {
        // A judge that is down never blocks someone's pay; the word floor stands.
        console.error("[rewards] TypeSafe gate failed, passing on the word floor:", err);
      }
    }
  }

  const survey = await env.DB.prepare("SELECT reward_budget_cents FROM surveys WHERE id = ?").bind(reward.survey_id).first<{ reward_budget_cents: number | null }>();
  if (survey?.reward_budget_cents !== null && survey?.reward_budget_cents !== undefined) {
    // This row is `pending`, so it is already inside `committedCents`.
    const committed = await committedCents(env.DB, reward.survey_id);
    if (committed > survey.reward_budget_cents) return { kind: "hold", reason: "over_budget" };
  }
  return { kind: "pass" };
}

async function setStatus(db: D1Database, rewardId: string, status: RewardStatus, extra: { holdReason?: HoldReason | null; error?: string | null } = {}) {
  await db
    .prepare("UPDATE rewards SET status = ?, hold_reason = ?, error = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, extra.holdReason ?? null, extra.error ?? null, rewardId)
    .run();
}

export async function getReward(db: D1Database, rewardId: string): Promise<RewardRow | null> {
  return db.prepare("SELECT * FROM rewards WHERE id = ?").bind(rewardId).first<RewardRow>();
}

/**
 * Ask the provider for the reward. Leaves the row `approved` (owed) when no
 * provider is connected. Returns the link a fresh order came with, for a
 * caller that delivers it at once (the WhatsApp bot); it is never stored.
 */
export async function payReward(env: Env, rewardId: string): Promise<{ reward: RewardRow; link: string | null }> {
  const reward = await getReward(env.DB, rewardId);
  if (!reward) throw new RewardError("Reward not found", 404);
  if (reward.status !== "approved") return { reward, link: null };
  if (!tremendousConfigured(env)) return { reward, link: null };

  const who = await env.DB
    .prepare(
      `SELECT u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone, u.email, u.linkedin_email, s.title
       FROM users u, surveys s WHERE u.id = ? AND s.id = ?`
    )
    .bind(reward.user_id, reward.survey_id)
    .first<{ first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null; email: string | null; linkedin_email: string | null; title: string | null }>();

  try {
    const made = await createLinkReward(env, {
      externalId: `parlo-reward-${reward.id}`,
      amountCents: reward.amount_cents,
      currency: reward.currency,
      // The provider gets a name and, when we hold one, an email; never the phone.
      recipient: { name: (who && displayNameFor(who)) || "Participant", email: who?.email ?? who?.linkedin_email ?? null },
      message: who?.title ? `Thank you for taking part in "${who.title}".` : "Thank you for taking part.",
    });
    await env.DB
      .prepare(
        `UPDATE rewards SET status = 'sent', provider = 'tremendous', provider_order_id = ?, provider_reward_id = ?,
                error = NULL, hold_reason = NULL, sent_at = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .bind(made.orderId, made.rewardId, new Date().toISOString(), reward.id)
      .run();
    trackServerEvent(reward.user_id, "reward_sent", { surveyId: reward.survey_id, roundId: reward.round_id, amountCents: reward.amount_cents, mode: tremendousMode(env) });
    return { reward: (await getReward(env.DB, reward.id)) as RewardRow, link: made.link };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[rewards] payout failed for ${reward.id}:`, message);
    await setStatus(env.DB, reward.id, "failed", { error: message.slice(0, 400) });
    trackServerEvent(reward.user_id, "reward_failed", { surveyId: reward.survey_id, roundId: reward.round_id, status: err instanceof TremendousError ? err.status : 0 });
    return { reward: (await getReward(env.DB, reward.id)) as RewardRow, link: null };
  }
}

export interface SettledReward {
  reward: RewardRow;
  /** Only when this call created the order; hand it to the member now or drop it. */
  link: string | null;
}

/**
 * Called once a response's transcripts exist: judge every `pending` reward
 * of that response, then pay what passed.
 */
export async function settleRewardsForResponse(env: Env, responseId: string): Promise<SettledReward[]> {
  const pending = await env.DB.prepare("SELECT * FROM rewards WHERE response_id = ? AND status = 'pending'").bind(responseId).all<RewardRow>();
  const out: SettledReward[] = [];
  for (const reward of pending.results) {
    const verdict = await judge(env, reward);
    if (verdict.kind === "wait") continue;
    if (verdict.kind === "hold") {
      await setStatus(env.DB, reward.id, "held", { holdReason: verdict.reason });
      trackServerEvent(reward.user_id, "reward_held", { surveyId: reward.survey_id, roundId: reward.round_id, reason: verdict.reason });
      out.push({ reward: (await getReward(env.DB, reward.id)) as RewardRow, link: null });
      continue;
    }
    await setStatus(env.DB, reward.id, "approved");
    trackServerEvent(reward.user_id, "reward_approved", { surveyId: reward.survey_id, roundId: reward.round_id, amountCents: reward.amount_cents });
    out.push(await payReward(env, reward.id));
  }
  return out;
}

/** Rewards that are owed but were never sent (no provider at the time). Called when a researcher opens the ledger. */
export async function payOwedRewards(env: Env, surveyId: string, limit = 10): Promise<number> {
  if (!tremendousConfigured(env)) return 0;
  const owed = await env.DB
    .prepare("SELECT id FROM rewards WHERE survey_id = ? AND status = 'approved' ORDER BY created_at ASC LIMIT ?")
    .bind(surveyId, limit)
    .all<{ id: string }>();
  let sent = 0;
  for (const row of owed.results) {
    const { reward } = await payReward(env, row.id);
    if (reward.status === "sent") sent++;
  }
  return sent;
}

// ── The member claims ──────────────────────────────────────────────────

/** A fresh redemption link for the member whose reward this is. */
export async function claimRewardLink(env: Env, reward: RewardRow): Promise<string> {
  let current = reward;
  if (current.status === "approved") {
    const paid = await payReward(env, current.id);
    current = paid.reward;
    if (paid.link) {
      await markClaimed(env, current);
      return paid.link;
    }
  }
  if (current.status !== "sent" || !current.provider_reward_id) {
    throw new RewardError(
      current.status === "approved" ? "Your reward is approved and will be ready to claim shortly." : "This reward isn't ready to claim.",
      409
    );
  }
  try {
    const link = await generateRewardLink(env, current.provider_reward_id);
    await markClaimed(env, current);
    return link;
  } catch (err) {
    console.error(`[rewards] link failed for ${current.id}:`, err);
    throw new RewardError("Couldn't open your reward just now. Please try again in a minute.", 502);
  }
}

async function markClaimed(env: Env, reward: RewardRow) {
  if (reward.claimed_at) return;
  await env.DB.prepare("UPDATE rewards SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL").bind(new Date().toISOString(), reward.id).run();
  trackServerEvent(reward.user_id, "reward_claim_opened", { surveyId: reward.survey_id, roundId: reward.round_id, amountCents: reward.amount_cents });
}

/** What a member sees of their own rewards in a study. Voided rows are not shown. */
export async function rewardsForMember(db: D1Database, surveyId: string, userId: string) {
  const rows = await db
    .prepare(
      `SELECT w.id, w.amount_cents, w.currency, w.status, w.claimed_at, r.number AS round_number
       FROM rewards w JOIN rounds r ON r.id = w.round_id
       WHERE w.survey_id = ? AND w.user_id = ? AND w.status != 'void' ORDER BY w.created_at DESC`
    )
    .bind(surveyId, userId)
    .all<{ id: string; amount_cents: number; currency: string; status: RewardStatus; claimed_at: string | null; round_number: number }>();
  return rows.results.map((r) => ({
    id: r.id,
    roundNumber: r.round_number,
    amountCents: r.amount_cents,
    currency: r.currency,
    // A member never needs the inner states: it is on its way, ready, or being looked at.
    state: r.status === "sent" ? ("ready" as const) : r.status === "held" ? ("review" as const) : ("preparing" as const),
    claimed: !!r.claimed_at,
  }));
}

// ── The researcher's ledger ────────────────────────────────────────────

export async function rewardSummary(env: Env, survey: { id: string; reward_cents?: number | null; reward_budget_cents?: number | null; reward_currency?: string | null }) {
  const rows = await env.DB
    .prepare("SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM rewards WHERE survey_id = ? GROUP BY status")
    .bind(survey.id)
    .all<{ status: RewardStatus; n: number; cents: number }>();
  const by = (s: RewardStatus) => rows.results.find((r) => r.status === s) ?? { n: 0, cents: 0 };
  const committed = by("pending").cents + by("approved").cents + by("sent").cents;
  const budgetCents = survey.reward_budget_cents ?? null;
  return {
    currency: survey.reward_currency || "USD",
    defaultCents: survey.reward_cents ?? null,
    budgetCents,
    committedCents: committed,
    remainingCents: budgetCents === null ? null : budgetCents - committed,
    sentCents: by("sent").cents,
    owedCents: by("approved").cents + by("pending").cents,
    heldCount: by("held").n,
    failedCount: by("failed").n,
    /** null = no provider connected: rewards are recorded and wait as owed. */
    payouts: tremendousMode(env),
  };
}

export async function listRewards(db: D1Database, surveyId: string) {
  const rows = await db
    .prepare(
      `SELECT w.*, r.number AS round_number, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone, gm.segment
       FROM rewards w
       JOIN rounds r ON r.id = w.round_id
       JOIN users u ON u.id = w.user_id
       LEFT JOIN group_members gm ON gm.survey_id = w.survey_id AND gm.user_id = w.user_id
       WHERE w.survey_id = ? ORDER BY w.created_at DESC LIMIT 200`
    )
    .bind(surveyId)
    .all<RewardRow & { round_number: number; first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null; segment: string | null }>();
  return rows.results.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: displayNameFor(r),
    segment: r.segment,
    roundNumber: r.round_number,
    responseId: r.response_id,
    amountCents: r.amount_cents,
    currency: r.currency,
    status: r.status,
    holdReason: r.hold_reason,
    error: r.error,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    claimedAt: r.claimed_at,
  }));
}

/** A researcher looked at a held reward and says pay it. */
export async function releaseReward(env: Env, surveyId: string, rewardId: string): Promise<RewardRow> {
  const reward = await getReward(env.DB, rewardId);
  if (!reward || reward.survey_id !== surveyId) throw new RewardError("Reward not found", 404);
  if (reward.status !== "held" && reward.status !== "failed") throw new RewardError("Only a held or failed reward can be released", 409);
  if (reward.status === "held" && reward.hold_reason === "over_budget") {
    const survey = await env.DB.prepare("SELECT reward_budget_cents FROM surveys WHERE id = ?").bind(surveyId).first<{ reward_budget_cents: number | null }>();
    const budget = survey?.reward_budget_cents ?? null;
    if (budget !== null && (await committedCents(env.DB, surveyId)) + reward.amount_cents > budget) {
      throw new RewardError("This would go over the study's budget. Raise the budget first.", 409);
    }
  }
  await setStatus(env.DB, reward.id, "approved");
  trackServerEvent(reward.user_id, "reward_approved", { surveyId, roundId: reward.round_id, amountCents: reward.amount_cents, by: "researcher" });
  return (await payReward(env, reward.id)).reward;
}

export async function voidReward(env: Env, surveyId: string, rewardId: string): Promise<RewardRow> {
  const reward = await getReward(env.DB, rewardId);
  if (!reward || reward.survey_id !== surveyId) throw new RewardError("Reward not found", 404);
  if (reward.status === "sent") throw new RewardError("This reward is already with the payout provider; cancel it there.", 409);
  if (reward.status === "void") return reward;
  await setStatus(env.DB, reward.id, "void");
  trackServerEvent(reward.user_id, "reward_voided", { surveyId, roundId: reward.round_id });
  return (await getReward(env.DB, reward.id)) as RewardRow;
}

export function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

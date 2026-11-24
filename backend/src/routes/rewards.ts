/**
 * Rewards.
 *
 *   /api/my/surveys/:id/rewards…   the research team: the ledger, the budget, held rewards
 *   /api/s/:code/reward…           a participant, by personal link: what they are owed, and claiming it
 */

import { Hono } from "hono";
import type { Env, Survey } from "../types";
import type { AuthVariables } from "../middleware/auth";
import { requireSeat } from "../services/access";
import { getMemberByToken } from "../services/groups";
import { extractCode } from "../services/slug";
import { checkRateLimit } from "../services/ratelimit";
import { trackServerEvent } from "../services/analytics";
import {
  claimRewardLink,
  getReward,
  listRewards,
  payOwedRewards,
  releaseReward,
  RewardError,
  rewardOfferFor,
  rewardsForMember,
  rewardSummary,
  sanitizeCents,
  voidReward,
} from "../services/rewards";

const rewards = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD"]);
/** A study's cap: up to a million in the currency's major unit. */
const MAX_BUDGET_CENTS = 100_000_000;

async function freshSurvey(db: D1Database, surveyId: string): Promise<Survey> {
  return (await db.prepare("SELECT * FROM surveys WHERE id = ?").bind(surveyId).first<Survey>()) as Survey;
}

// ── The research team ────────────────────────────────────────────────

rewards.get("/api/my/surveys/:surveyId/rewards", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "manage");
  if (gate instanceof Response) return gate;
  // Anything approved while no provider was connected goes out now.
  await payOwedRewards(c.env, gate.survey.id).catch((err) => console.error("[rewards] payOwed failed", err));
  return c.json({ summary: await rewardSummary(c.env, gate.survey), rewards: await listRewards(c.env.DB, gate.survey.id) });
});

rewards.put("/api/my/surveys/:surveyId/rewards/settings", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "manage");
  if (gate instanceof Response) return gate;
  type Body = { budgetCents?: number | null; defaultCents?: number | null; currency?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const updates: string[] = [];
  const binds: (string | number | null)[] = [];

  if (body.budgetCents !== undefined) {
    const budget = body.budgetCents === null ? null : sanitizeCents(body.budgetCents, MAX_BUDGET_CENTS);
    if (body.budgetCents !== null && budget === null) return c.json({ error: "budgetCents must be a positive number, or null for no cap" }, 400);
    updates.push("reward_budget_cents = ?");
    binds.push(budget);
  }
  if (body.defaultCents !== undefined) {
    const price = body.defaultCents === null ? null : sanitizeCents(body.defaultCents);
    if (body.defaultCents !== null && price === null) return c.json({ error: "defaultCents must be a positive number, or null" }, 400);
    updates.push("reward_cents = ?");
    binds.push(price || null);
  }
  if (body.currency !== undefined) {
    const currency = String(body.currency).toUpperCase();
    if (!CURRENCIES.has(currency)) return c.json({ error: `currency must be one of ${Array.from(CURRENCIES).join(", ")}` }, 400);
    const any = await c.env.DB.prepare("SELECT 1 FROM rewards WHERE survey_id = ? LIMIT 1").bind(gate.survey.id).first();
    if (any && currency !== (gate.survey.reward_currency || "USD")) return c.json({ error: "The currency can't change once a reward exists" }, 409);
    updates.push("reward_currency = ?");
    binds.push(currency);
  }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);
  await c.env.DB.prepare(`UPDATE surveys SET ${updates.join(", ")} WHERE id = ?`).bind(...binds, gate.survey.id).run();
  trackServerEvent(gate.membership.user_id, "reward_settings_changed", { surveyId: gate.survey.id, fields: updates.length });
  return c.json({ summary: await rewardSummary(c.env, await freshSurvey(c.env.DB, gate.survey.id)) });
});

rewards.post("/api/my/surveys/:surveyId/rewards/:rewardId/:action{release|void}", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "manage");
  if (gate instanceof Response) return gate;
  try {
    const reward =
      c.req.param("action") === "release"
        ? await releaseReward(c.env, gate.survey.id, c.req.param("rewardId"))
        : await voidReward(c.env, gate.survey.id, c.req.param("rewardId"));
    return c.json({ ok: true, status: reward.status, error: reward.error, summary: await rewardSummary(c.env, gate.survey) });
  } catch (err) {
    if (err instanceof RewardError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

// ── The participant ──────────────────────────────────────────────────

async function memberOf(c: { env: Env; req: { param(name: string): string; query(name: string): string | undefined } }) {
  const code = extractCode(c.req.param("code"));
  const survey = await c.env.DB.prepare("SELECT * FROM surveys WHERE code = ? AND status != 'deleted'").bind(code).first<Survey>();
  if (!survey) return null;
  const member = await getMemberByToken(c.env.DB, survey.id, c.req.query("t"));
  return member ? { survey, member } : null;
}

/** What answering now pays, and the rewards this member already has here. */
rewards.get("/api/s/:code/reward", async (c) => {
  const found = await memberOf(c);
  if (!found) return c.json({ error: "This link isn't valid for this parlo" }, 403);
  return c.json({
    offer: await rewardOfferFor(c.env.DB, found.survey, found.member),
    rewards: await rewardsForMember(c.env.DB, found.survey.id, found.member.user_id),
  });
});

/**
 * A fresh redemption link for a reward of this member's. The link is a
 * bearer secret: it is made now, handed over, and kept nowhere.
 */
rewards.post("/api/s/:code/reward/:rewardId/claim", async (c) => {
  const found = await memberOf(c);
  if (!found) return c.json({ error: "This link isn't valid for this parlo" }, 403);
  if (!(await checkRateLimit(c.env.KV, "reward-claim", found.member.user_id, 20))) return c.json({ error: "Too many attempts. Try again later." }, 429);
  const reward = await getReward(c.env.DB, c.req.param("rewardId"));
  if (!reward || reward.survey_id !== found.survey.id || reward.user_id !== found.member.user_id) return c.json({ error: "Reward not found" }, 404);
  try {
    return c.json({ url: await claimRewardLink(c.env, reward) }, 200, { "cache-control": "no-store" });
  } catch (err) {
    if (err instanceof RewardError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});

export default rewards;

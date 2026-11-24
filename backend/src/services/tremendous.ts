/**
 * Tremendous: the rail rewards travel on. Parlo owns the ledger
 * (`services/rewards.ts`); this file only knows how to ask Tremendous for a
 * reward a person redeems by link, and for a fresh link to it later.
 *
 * Docs: https://developers.tremendous.com/llms.txt
 *   POST /orders  with delivery.method = "LINK"  → order.rewards[0].delivery.link
 *   POST /rewards/{id}/generate_link             → reward.link
 *
 * Links are bearer secrets ("treat links as passwords"): they are never
 * stored. The ledger keeps the order and reward ids and a new link is made
 * each time the member asks for theirs.
 *
 * Environments: a `TEST_` key talks to the sandbox (fake money). A `PROD_`
 * key spends real money only when `TREMENDOUS_ENV` is also "production", so
 * one misplaced secret cannot move money on its own.
 */

import type { Env } from "../types";

const SANDBOX_BASE = "https://testflight.tremendous.com/api/v2";
const PRODUCTION_BASE = "https://api.tremendous.com/api/v2";
const CAMPAIGN_CACHE_KEY = "tremendous:campaign";

export class TremendousError extends Error {
  constructor(message: string, public status: number, public retryable: boolean) {
    super(message);
    this.name = "TremendousError";
  }
}

export function tremendousConfigured(env: Env): boolean {
  return !!env.TREMENDOUS_API_KEY;
}

/** "sandbox" | "production", or null when no key is set. */
export function tremendousMode(env: Env): "sandbox" | "production" | null {
  if (!env.TREMENDOUS_API_KEY) return null;
  return env.TREMENDOUS_API_KEY.startsWith("PROD_") && env.TREMENDOUS_ENV === "production" ? "production" : "sandbox";
}

function apiBase(env: Env): string {
  if (env.TREMENDOUS_API_BASE) return env.TREMENDOUS_API_BASE.replace(/\/+$/, "");
  const key = env.TREMENDOUS_API_KEY ?? "";
  if (key.startsWith("PROD_")) {
    if (env.TREMENDOUS_ENV !== "production") {
      throw new TremendousError("A production Tremendous key is set but TREMENDOUS_ENV is not \"production\"; refusing to spend real money.", 0, false);
    }
    return PRODUCTION_BASE;
  }
  return SANDBOX_BASE;
}

/** The API answers errors as `{errors: {message, payload}}`; flatten to one sentence. */
function errorSentence(body: unknown, status: number): string {
  const errors = (body as { errors?: { message?: string; payload?: unknown } } | null)?.errors;
  const parts: string[] = [];
  if (errors?.message) parts.push(errors.message);
  const walk = (node: unknown) => {
    if (typeof node === "string") parts.push(node);
    else if (node && typeof node === "object") for (const v of Object.values(node as Record<string, unknown>)) walk(v);
  };
  walk(errors?.payload);
  return (parts.join(" · ") || `Tremendous answered ${status}`).slice(0, 400);
}

async function call<T>(env: Env, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; data: T }> {
  if (!env.TREMENDOUS_API_KEY) throw new TremendousError("Payouts are not connected", 0, false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${apiBase(env)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.TREMENDOUS_API_KEY}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof TremendousError) throw err;
    throw new TremendousError(`Could not reach Tremendous: ${err instanceof Error ? err.message : String(err)}`, 0, true);
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as T;
  if (!res.ok) {
    // 402 = the balance is short; 429 and 5xx pass. Everything else needs a person.
    const retryable = res.status === 402 || res.status === 429 || res.status >= 500;
    throw new TremendousError(errorSentence(data, res.status), res.status, retryable);
  }
  return { status: res.status, data };
}

/** The campaign whose catalogue recipients choose from: configured, else the account's first. */
async function campaignId(env: Env): Promise<string> {
  if (env.TREMENDOUS_CAMPAIGN_ID) return env.TREMENDOUS_CAMPAIGN_ID;
  const cacheKey = `${CAMPAIGN_CACHE_KEY}:${tremendousMode(env)}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return cached;
  const { data } = await call<{ campaigns?: { id: string }[] }>(env, "GET", "/campaigns?limit=1");
  const id = data?.campaigns?.[0]?.id;
  if (!id) {
    throw new TremendousError("The Tremendous account has no campaign. Create one in its dashboard, or set TREMENDOUS_CAMPAIGN_ID.", 0, false);
  }
  await env.KV.put(cacheKey, id, { expirationTtl: 24 * 3600 });
  return id;
}

export interface LinkRewardInput {
  /** Makes the order idempotent at Tremendous: the same id never creates a second order. */
  externalId: string;
  amountCents: number;
  currency: string;
  recipient: { name: string; email?: string | null; phone?: string | null };
  /** Shown on the redemption page. */
  message?: string;
}

export interface LinkReward {
  orderId: string;
  rewardId: string;
  /** Present on a fresh order; a repeated `external_id` returns the order without one. */
  link: string | null;
}

interface OrderResponse {
  order?: {
    id: string;
    status?: string;
    rewards?: { id: string; delivery?: { method?: string; status?: string; link?: string } }[];
  };
}

/** Create a reward the recipient redeems by link. Never stores or logs the link. */
export async function createLinkReward(env: Env, input: LinkRewardInput): Promise<LinkReward> {
  const recipient: Record<string, string> = { name: input.recipient.name.slice(0, 120) || "Participant" };
  if (input.recipient.email) recipient.email = input.recipient.email;
  if (input.recipient.phone) recipient.phone = input.recipient.phone;
  const { data } = await call<OrderResponse>(env, "POST", "/orders", {
    external_id: input.externalId,
    payment: { funding_source_id: env.TREMENDOUS_FUNDING_SOURCE_ID || "BALANCE" },
    reward: {
      campaign_id: await campaignId(env),
      value: { denomination: input.amountCents / 100, currency_code: input.currency },
      delivery: {
        method: "LINK",
        ...(input.message ? { meta: { message: input.message.slice(0, 500) } } : {}),
      },
      recipient,
    },
  });
  const order = data?.order;
  const reward = order?.rewards?.[0];
  if (!order?.id || !reward?.id) throw new TremendousError("Tremendous answered without an order or a reward", 0, true);
  return { orderId: order.id, rewardId: reward.id, link: reward.delivery?.link ?? null };
}

/** A fresh redemption link for an existing reward. Earlier links stay valid. */
export async function generateRewardLink(env: Env, rewardId: string): Promise<string> {
  const { data } = await call<{ reward?: { id: string; link?: string } }>(env, "POST", `/rewards/${encodeURIComponent(rewardId)}/generate_link`);
  const link = data?.reward?.link;
  if (!link) throw new TremendousError("Tremendous answered without a link", 0, true);
  return link;
}

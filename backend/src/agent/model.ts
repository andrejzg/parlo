/**
 * Which model runs the group agent's planning loop.
 *
 * The AI SDK is the seam: every provider exposes the same `LanguageModel`,
 * so switching is one line. Preference order:
 *   1. Claude (Opus 5.5) when ANTHROPIC_API_KEY is set — strongest at reading
 *      a pile of transcripts and planning tool calls.
 *   2. Cerebras gpt-oss-120b (the key the backend already has) — fast, tool
 *      calling supported.
 *   3. Workers AI Llama 3.3 70B — needs no key at all.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel } from "ai";
import type { Env } from "../types";

export interface PickedModel {
  model: LanguageModel;
  provider: "anthropic" | "cerebras" | "cloudflare-workers-ai";
  modelId: string;
}

export const ANTHROPIC_MODEL = "claude-opus-5-5";
export const CEREBRAS_AGENT_MODEL = "gpt-oss-120b";
export const WORKERS_AI_AGENT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Every model the agent can run on, best first. */
export function agentModels(env: Env): PickedModel[] {
  const out: PickedModel[] = [];
  if (env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    out.push({ model: anthropic(ANTHROPIC_MODEL), provider: "anthropic", modelId: ANTHROPIC_MODEL });
  }
  if (env.CEREBRAS_API_KEY) {
    const cerebras = createCerebras({ apiKey: env.CEREBRAS_API_KEY });
    out.push({ model: cerebras(CEREBRAS_AGENT_MODEL), provider: "cerebras", modelId: CEREBRAS_AGENT_MODEL });
  }
  const workersai = createWorkersAI({ binding: env.AI });
  out.push({
    model: workersai(WORKERS_AI_AGENT_MODEL as Parameters<typeof workersai>[0]),
    provider: "cloudflare-workers-ai",
    modelId: WORKERS_AI_AGENT_MODEL,
  });
  return out;
}

/** The first choice. Prefer `runOnAgentModel`, which survives that choice failing. */
export function pickAgentModel(env: Env): PickedModel {
  return agentModels(env)[0];
}

/**
 * A provider that just failed is skipped for a while, so a dead key costs
 * one failed call per isolate rather than one per run.
 */
const benched = new Map<PickedModel["provider"], number>();
const BENCH_MS = 10 * 60_000;

/**
 * Run a model call on the best provider that works. A key being set says
 * nothing about it being valid: until 2026-11-24 an expired Anthropic key
 * (it lapsed around 2026-11-10) made every digest and proposal throw a 401
 * while two working providers sat unused. Now a failure moves on to the
 * next provider, and the caller learns which one answered.
 */
export async function runOnAgentModel<T>(env: Env, run: (picked: PickedModel) => Promise<T>): Promise<{ result: T; picked: PickedModel }> {
  const all = agentModels(env);
  const now = Date.now();
  const fresh = all.filter((m) => (benched.get(m.provider) ?? 0) <= now);
  // If everything is benched, try them all again rather than give up.
  const order = fresh.length ? fresh : all;
  let lastError: unknown;
  for (const picked of order) {
    try {
      const result = await run(picked);
      benched.delete(picked.provider);
      return { result, picked };
    } catch (err) {
      lastError = err;
      benched.set(picked.provider, Date.now() + BENCH_MS);
      console.error(`[agent-model] ${picked.provider} failed, trying the next provider:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastError;
}

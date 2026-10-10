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

export function pickAgentModel(env: Env): PickedModel {
  if (env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return { model: anthropic(ANTHROPIC_MODEL), provider: "anthropic", modelId: ANTHROPIC_MODEL };
  }
  if (env.CEREBRAS_API_KEY) {
    const cerebras = createCerebras({ apiKey: env.CEREBRAS_API_KEY });
    return { model: cerebras(CEREBRAS_AGENT_MODEL), provider: "cerebras", modelId: CEREBRAS_AGENT_MODEL };
  }
  const workersai = createWorkersAI({ binding: env.AI });
  return {
    model: workersai(WORKERS_AI_AGENT_MODEL as Parameters<typeof workersai>[0]),
    provider: "cloudflare-workers-ai",
    modelId: WORKERS_AI_AGENT_MODEL,
  };
}

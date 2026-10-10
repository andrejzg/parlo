/**
 * TypeSafe System One client (Jev).
 *
 * Jev doesn't generate text — you send a `state` plus named typed questions
 * and it returns calibrated probabilities. We use Noul (yes/no) questions to
 * decide which brief-checklist items a creator has covered while they talk.
 *
 * Docs: https://docs.typesafe.ai/api.md
 *   POST https://api.typesafe.ai/v1/systemone
 *   Authorization: Bearer <TYPESAFE_API_KEY>
 *   { model, state, questions: { <id>: { type: "noul", instructions, criteria? } } }
 *   → { model, answers: { <id>: { type: "noul", noul: 0..1 } }, usage }
 */

import { trackServerEvent } from "./analytics";
import { nanoid } from "nanoid/non-secure";

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_MODEL = "jev-latest";
/** USD per input token (typesafe.ai pricing: $42 per billion; output is free). */
const TYPESAFE_INPUT_USD_PER_TOKEN = 0.042 / 1_000_000;

export interface NoulQuestion {
  type: "noul";
  instructions: string | Record<string, unknown>;
  criteria?: { true: string; false: string };
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface SystemOneResult<K extends string> {
  model: string;
  answers: Record<K, NoulAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class TypeSafeError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "TypeSafeError";
  }
}

/**
 * Run a batch of Noul questions against a state. Retries once on 429/529
 * (the only statuses TypeSafe documents as retryable). Never swallows errors —
 * callers decide whether to fall back to another provider.
 */
export async function systemOne<K extends string>(
  apiKey: string,
  state: unknown,
  questions: Record<K, NoulQuestion>,
  opts: { traceId?: string; timeoutMs?: number; properties?: Record<string, unknown> } = {}
): Promise<SystemOneResult<K>> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const traceId = opts.traceId ?? nanoid();
  const body = JSON.stringify({ model: TYPESAFE_MODEL, state, questions });

  const start = Date.now();
  let isError = false;
  let errorMsg: string | undefined;
  let result: SystemOneResult<K> | undefined;

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(TYPESAFE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        result = (await res.json()) as SystemOneResult<K>;
        return result;
      }

      const text = (await res.text().catch(() => "")).slice(0, 300);
      if ((res.status === 429 || res.status === 529) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw new TypeSafeError(`TypeSafe ${res.status}: ${text}`, res.status);
    }
    throw new TypeSafeError("TypeSafe: retries exhausted");
  } catch (err: any) {
    isError = true;
    errorMsg = err?.message ?? String(err);
    throw err;
  } finally {
    const latency = (Date.now() - start) / 1000;
    trackServerEvent("parlo-ai", "$ai_generation", {
      $ai_trace_id: traceId,
      $ai_model: result?.model ?? TYPESAFE_MODEL,
      $ai_provider: "typesafe",
      $ai_input: { state, questions },
      $ai_output_choices: result ? [{ message: { content: JSON.stringify(result.answers) } }] : [],
      $ai_input_tokens: result?.usage.input_tokens,
      $ai_output_tokens: result?.usage.output_tokens,
      ...(result && {
        $ai_input_cost_usd: result.usage.input_tokens * TYPESAFE_INPUT_USD_PER_TOKEN,
        $ai_output_cost_usd: 0,
        $ai_total_cost_usd: result.usage.input_tokens * TYPESAFE_INPUT_USD_PER_TOKEN,
      }),
      $ai_latency: latency,
      $ai_is_error: isError,
      ...(errorMsg && { $ai_error: errorMsg }),
      ...opts.properties,
    });
  }
}

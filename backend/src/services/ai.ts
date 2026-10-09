/**
 * AI pipeline services: Workers AI Whisper (STT) + Cerebras GPT OSS question generation
 * (Workers AI Llama fallback)
 * With PostHog LLM observability ($ai_generation events)
 */

import { trackServerEvent } from "./analytics";
import { nanoid } from "nanoid/non-secure";

/**
 * Transcribe an audio file using Workers AI Whisper model.
 */
export async function transcribeAudio(
  ai: any,
  audioBlob: ArrayBuffer,
  traceId?: string
): Promise<string> {
  const start = Date.now();
  let isError = false;
  let errorMsg: string | undefined;
  let outputText = "";

  try {
    const result = await ai.run("@cf/openai/whisper", {
      audio: [...new Uint8Array(audioBlob)],
    });
    outputText = result.text;
    return outputText;
  } catch (err: any) {
    isError = true;
    errorMsg = err?.message ?? String(err);
    throw err;
  } finally {
    const latency = (Date.now() - start) / 1000;
    trackServerEvent("parlo-ai", "$ai_generation", {
      $ai_trace_id: traceId ?? nanoid(),
      $ai_model: "@cf/openai/whisper",
      $ai_provider: "cloudflare-workers-ai",
      $ai_input: `[audio: ${audioBlob.byteLength} bytes]`,
      $ai_output_choices: outputText ? [{ message: { content: outputText } }] : [],
      $ai_latency: latency,
      $ai_is_error: isError,
      ...(errorMsg && { $ai_error: errorMsg }),
    });
  }
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant that generates voice survey questions. Always respond in valid JSON.";

const DEFAULT_USER_PROMPT = `Create a survey based on these creator descriptions:

1. AUDIENCE: {{audience}}
2. INFO TO GATHER: {{gather}}

Generate a JSON response with:
- "title": short catchy survey title (max 50 chars)
- "questions": array of objects, each with:
    - "text" (the question)
    - "hint" (e.g. "Question 1 of 3")
    - "type" (optional, one of "voice", "photo", or "video" — defaults to "voice")

IMPORTANT: Generate the number of questions the creator asked for. If they said "2 questions", generate exactly 2. If they didn't specify a number, default to 3. Pay close attention to what they actually want to ask — use their exact questions if they provided them, just make them sound warm and conversational.

QUESTION TYPES:
- Default to "voice" — people answer by speaking, so keep questions open-ended and natural.
- Use "photo" ONLY when the most natural way to answer is to show something visual and STATIC:
  - "Show me your workspace right now"
  - "Take a picture of what you're eating for breakfast"
  - "Snap a photo of the product packaging"
  - "Show me where you usually relax"
  Photo questions are great for capturing visual context that words can't convey. Use them sparingly — at most 1 photo question per 3 voice questions, and only when the gather goal genuinely calls for visual evidence.
- Use "video" ONLY for DYNAMIC/TEMPORAL evidence — when motion or process matters and a still photo wouldn't be enough:
  - "Show me how you use this product (tap record and walk me through it)"
  - "Record yourself walking through your morning routine"
  - "Demo your favourite feature in the app"
  - "Show me what's happening around you right now"
  Videos capture action and sequence that photos can't. Use even more sparingly than photos — at most 1 video per 5 questions, and only when the gather goal genuinely requires seeing motion, demonstration, or sequence over time. Videos are capped at 60 seconds, so keep the prompt focused.

If the creator's gather goal involves static visual evidence ("see what people are eating", "show me their setup", "what does X look like"), include 1-2 photo questions. If it involves seeing a process or demonstration ("walk me through", "show me how you do X", "demo it"), include a single video question. Otherwise, all questions should be voice.`;

/**
 * Load a prompt from KV, falling back to the default.
 * Prompts are editable at runtime via:
 *   wrangler kv put --namespace-id <KV_ID> "prompt:system" "Your new system prompt"
 *   wrangler kv put --namespace-id <KV_ID> "prompt:user" "Your new user prompt with {{audience}} and {{gather}} placeholders"
 */
async function getPrompt(kv: KVNamespace, key: string, fallback: string): Promise<string> {
  const stored = await kv.get(`prompt:${key}`);
  return stored ?? fallback;
}

/**
 * Send 2 transcriptions to Llama to generate a survey title + questions.
 * Prompts are loaded from KV (editable without redeploy) with hardcoded defaults.
 */
export async function generateQuestions(
  ai: any,
  kv: KVNamespace,
  transcriptions: { audience: string; gather: string },
  cerebrasApiKey?: string
): Promise<GeneratedSurvey> {
  const systemPrompt = await getPrompt(kv, "system", DEFAULT_SYSTEM_PROMPT);
  const userTemplate = await getPrompt(kv, "user", DEFAULT_USER_PROMPT);

  // Read version metadata (may not exist for legacy / un-seeded prompts)
  const [systemMetaRaw, userMetaRaw] = await Promise.all([
    kv.get("prompt:system:meta"),
    kv.get("prompt:user:meta"),
  ]);
  const systemVersion = systemMetaRaw ? (JSON.parse(systemMetaRaw) as { currentVersion: number }).currentVersion : null;
  const userVersion = userMetaRaw ? (JSON.parse(userMetaRaw) as { currentVersion: number }).currentVersion : null;

  // Replace placeholders with actual transcriptions
  const userPrompt = userTemplate
    .replace(/\{\{audience\}\}/g, transcriptions.audience)
    .replace(/\{\{gather\}\}/g, transcriptions.gather);

  console.log("[ai] Using prompts from KV (or defaults), system v%s, user v%s", systemVersion, userVersion);

  const traceId = nanoid();
  const input = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // Cerebras first (fast); Workers AI Llama as a fallback if the key is
  // missing or the call/parse fails, so generation never hard-fails on one provider.
  const providers: { provider: string; model: string; run: () => Promise<string> }[] = [];
  if (cerebrasApiKey) {
    providers.push({ provider: "cerebras", model: CEREBRAS_MODEL, run: () => runCerebras(cerebrasApiKey, input) });
  }
  providers.push({
    provider: "cloudflare-workers-ai",
    model: WORKERS_AI_MODEL,
    run: async () => {
      const result = await ai.run(WORKERS_AI_MODEL, { messages: input });
      return result.response ?? result.text ?? "";
    },
  });

  let lastError: unknown;
  for (const { provider, model, run } of providers) {
    const start = Date.now();
    let isError = false;
    let errorMsg: string | undefined;
    let outputText = "";

    try {
      outputText = (await run()).trim();
      console.log(`[ai] Raw ${provider} response:`, outputText);
      const parsed = parseGeneratedSurvey(outputText);
      console.log("[ai] Parsed questions:", JSON.stringify(parsed));
      return parsed;
    } catch (err: any) {
      isError = true;
      errorMsg = err?.message ?? String(err);
      lastError = err;
      console.error(`[ai] ${provider} generation failed:`, errorMsg);
    } finally {
      const latency = (Date.now() - start) / 1000;
      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: traceId,
        $ai_model: model,
        $ai_provider: provider,
        $ai_input: input,
        $ai_output_choices: outputText ? [{ message: { content: outputText } }] : [],
        $ai_latency: latency,
        $ai_is_error: isError,
        ...(errorMsg && { $ai_error: errorMsg }),
        // Custom properties
        audience: transcriptions.audience,
        gather: transcriptions.gather,
        $ai_prompt_version_system: systemVersion,
        $ai_prompt_version_user: userVersion,
      });
    }
  }
  throw lastError;
}

type GeneratedSurvey = {
  title: string;
  questions: { text: string; hint: string; type?: "voice" | "photo" | "video" }[];
};

const CEREBRAS_MODEL = "gpt-oss-120b";
const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

async function runCerebras(apiKey: string, messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages,
      response_format: { type: "json_object" },
      reasoning_effort: "low",
    }),
  });
  if (!res.ok) {
    throw new Error(`Cerebras ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

function parseGeneratedSurvey(text: string): GeneratedSurvey {
  let jsonStr = text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }
  const parsed = JSON.parse(jsonStr) as GeneratedSurvey;
  if (!parsed.title || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error("Invalid response structure from AI");
  }
  return parsed;
}

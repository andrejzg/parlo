/**
 * AI pipeline services: Workers AI (Whisper STT + Llama question generation)
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
  transcriptions: { audience: string; gather: string }
): Promise<{ title: string; questions: { text: string; hint: string; type?: "voice" | "photo" | "video" }[] }> {
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

  const start = Date.now();
  let isError = false;
  let errorMsg: string | undefined;
  let outputText = "";

  try {
    const result = await ai.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      { messages: input }
    );

    console.log("[ai] Raw Llama response:", JSON.stringify(result));
    let jsonStr = (result.response ?? result.text ?? "").trim();
    outputText = jsonStr;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    console.log("[ai] Extracted JSON string:", jsonStr);

    const parsed = JSON.parse(jsonStr) as {
      title: string;
      questions: { text: string; hint: string; type?: "voice" | "photo" | "video" }[];
    };

    console.log("[ai] Parsed questions:", JSON.stringify(parsed));

    if (
      !parsed.title ||
      !Array.isArray(parsed.questions) ||
      parsed.questions.length === 0
    ) {
      throw new Error("Invalid response structure from AI");
    }

    return parsed;
  } catch (err: any) {
    isError = true;
    errorMsg = err?.message ?? String(err);
    throw err;
  } finally {
    const latency = (Date.now() - start) / 1000;
    trackServerEvent("parlo-ai", "$ai_generation", {
      $ai_trace_id: traceId,
      $ai_model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      $ai_provider: "cloudflare-workers-ai",
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

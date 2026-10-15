/**
 * AI pipeline services: Workers AI Whisper (STT) + Cerebras GPT OSS generation
 * (Workers AI Llama fallback). TypeSafe Jev lives in ./typesafe.ts.
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

// ── Prompts ──────────────────────────────────────────────────────────
// Defaults live here; the admin API (routes/admin.ts) imports them so the
// two never drift. Runtime overrides are read from KV (`prompt:<name>`).

export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant that generates voice survey questions. Always respond in valid JSON.";

const QUESTION_TYPE_GUIDANCE = `QUESTION TYPES:
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

/** Legacy two-answer flow (audience + gather). Still used by the MCP server. */
export const DEFAULT_USER_PROMPT = `Create a survey based on these creator descriptions:

1. AUDIENCE: {{audience}}
2. INFO TO GATHER: {{gather}}

Generate a JSON response with:
- "title": short catchy survey title (max 50 chars)
- "questions": array of objects, each with:
    - "text" (the question)
    - "hint" (e.g. "Question 1 of 3")
    - "type" (optional, one of "voice", "photo", or "video" — defaults to "voice")

IMPORTANT: Generate the number of questions the creator asked for. If they said "2 questions", generate exactly 2. If they didn't specify a number, default to 3. Pay close attention to what they actually want to ask — use their exact questions if they provided them, just make them sound warm and conversational.

${QUESTION_TYPE_GUIDANCE}`;

/**
 * Agent brief flow: one free-form description of the research agent plus a
 * list of clarifying Q&A pairs. Placeholders: {{brief}}, {{clarifications}}.
 */
export const DEFAULT_BRIEF_PROMPT = `A creator described, by voice, the research agent (an AI voice interviewer) they want to build. Turn it into the interview that agent will run.

BRIEF (transcribed speech — may be rambling, read for intent):
{{brief}}

CLARIFYING QUESTIONS THE CREATOR ANSWERED AFTERWARDS:
{{clarifications}}

Generate a JSON response with:
- "title": short catchy title for the interview (max 50 chars), written for the participants who'll see it
- "questions": array of objects, each with:
    - "text" (the question, warm and conversational, as the agent would say it out loud)
    - "hint" (e.g. "Question 1 of 5")
    - "type" (optional, one of "voice", "photo", or "video" — defaults to "voice")

IMPORTANT:
- Generate the number of questions the creator asked for. If they didn't specify, default to 5.
- Order them like a good interviewer would: easy warm-up first, the most important question in the middle, reflective close.
- Honour the tone the creator described (formal, playful, concise...). If they gave exact questions, keep their wording, just make it sound natural spoken aloud.
- Everything the creator clarified afterwards overrides the brief where they conflict.

${QUESTION_TYPE_GUIDANCE}`;

/**
 * Next clarifying question. Placeholders: {{brief}}, {{clarifications}},
 * {{count}} (how many clarifications were answered so far).
 */
export const DEFAULT_CLARIFY_PROMPT = `A creator is setting up a research agent: an AI interviewer that will talk to people by voice. You're helping them sharpen it by asking ONE short clarifying question at a time.

THEIR BRIEF (transcribed speech):
{{brief}}

CLARIFICATIONS SO FAR ({{count}} answered):
{{clarifications}}

Ask the single most useful next question. Rules:
- You are talking to the CREATOR, the person running the research, never to the participants. "You" always means the creator. Ask about their intent, context, and what they need, never about their own experience as if they were a participant.
- Exactly one question. Conversational, second person, at most 20 words, no preamble, no numbering.
- Pick whatever would most change the interview questions the agent asks: specifics about the audience, the decision the answers feed into, must-ask topics, depth vs. breadth, sensitive areas to avoid, what a great answer looks like, examples from their world.
- Never ask something the brief or an earlier answer already covers, and never rephrase an earlier question. Build on what they said.
- Keep it easy to answer out loud in one breath.

Return JSON: {"question": "...", "hint": "..."} where "hint" is a nudge of at most 12 words on how the creator might answer (e.g. "Rough is fine — a sentence or two").`;

const CLARIFY_SYSTEM_PROMPT =
  "You are Parlo, a warm, sharp research strategist helping someone set up a voice interview. Always respond in valid JSON.";

export const PROMPT_DEFAULTS: Record<string, string> = {
  system: DEFAULT_SYSTEM_PROMPT,
  user: DEFAULT_USER_PROMPT,
  brief: DEFAULT_BRIEF_PROMPT,
  clarify: DEFAULT_CLARIFY_PROMPT,
};

/**
 * Load a prompt from KV (editable at runtime via parlo.me/admin), falling
 * back to the default. Also returns the version number when known.
 */
async function loadPrompt(
  kv: KVNamespace,
  key: string,
  fallback: string
): Promise<{ content: string; version: number | null }> {
  const [stored, metaRaw] = await Promise.all([
    kv.get(`prompt:${key}`),
    kv.get(`prompt:${key}:meta`),
  ]);
  const version = metaRaw ? (JSON.parse(metaRaw) as { currentVersion: number }).currentVersion : null;
  return { content: stored ?? fallback, version };
}

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (out, [k, v]) => out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
    template
  );
}

export function formatClarifications(
  clarifications: { question: string; answer: string }[]
): string {
  if (clarifications.length === 0) return "(none yet)";
  return clarifications
    .map((c, i) => `${i + 1}. Q: ${c.question}\n   A: ${c.answer}`)
    .join("\n");
}

// ── Providers ────────────────────────────────────────────────────────

export const CEREBRAS_MODEL = "gpt-oss-120b";
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

type ChatMessage = { role: string; content: string };

export async function runCerebras(
  apiKey: string,
  messages: ChatMessage[],
  opts: { maxTokens?: number } = {}
): Promise<string> {
  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages,
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      ...(opts.maxTokens && { max_tokens: opts.maxTokens }),
    }),
  });
  if (!res.ok) {
    throw new Error(`Cerebras ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Run a JSON-producing chat completion: Cerebras first (fast), Workers AI
 * Llama as a fallback if the key is missing or the call/parse fails, so
 * nothing hard-fails on one provider. Every attempt is tracked in PostHog.
 */
export async function runJsonCompletion<T>(
  ai: any,
  cerebrasApiKey: string | undefined,
  messages: ChatMessage[],
  parse: (text: string) => T,
  meta: { traceId?: string; properties?: Record<string, unknown>; maxTokens?: number } = {}
): Promise<T> {
  const traceId = meta.traceId ?? nanoid();
  const providers: { provider: string; model: string; run: () => Promise<string> }[] = [];
  if (cerebrasApiKey) {
    providers.push({
      provider: "cerebras",
      model: CEREBRAS_MODEL,
      run: () => runCerebras(cerebrasApiKey, messages, { maxTokens: meta.maxTokens }),
    });
  }
  providers.push({
    provider: "cloudflare-workers-ai",
    model: WORKERS_AI_MODEL,
    run: async () => {
      const result = await ai.run(WORKERS_AI_MODEL, { messages });
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
      console.log(`[ai] Raw ${provider} response:`, outputText.slice(0, 2000));
      return parse(outputText);
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
        $ai_input: messages,
        $ai_output_choices: outputText ? [{ message: { content: outputText } }] : [],
        $ai_latency: latency,
        $ai_is_error: isError,
        ...(errorMsg && { $ai_error: errorMsg }),
        ...meta.properties,
      });
    }
  }
  throw lastError;
}

// ── Question generation ──────────────────────────────────────────────

export type GeneratedSurvey = {
  title: string;
  questions: { text: string; hint: string; type?: "voice" | "photo" | "video" }[];
};

function extractJson(text: string): string {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return jsonMatch ? jsonMatch[1].trim() : text;
}

function parseGeneratedSurvey(text: string): GeneratedSurvey {
  const parsed = JSON.parse(extractJson(text)) as GeneratedSurvey;
  if (!parsed.title || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error("Invalid response structure from AI");
  }
  return parsed;
}

/**
 * Legacy flow: two transcriptions (audience + gather) → title + questions.
 */
export async function generateQuestions(
  ai: any,
  kv: KVNamespace,
  transcriptions: { audience: string; gather: string },
  cerebrasApiKey?: string
): Promise<GeneratedSurvey> {
  const [system, user] = await Promise.all([
    loadPrompt(kv, "system", DEFAULT_SYSTEM_PROMPT),
    loadPrompt(kv, "user", DEFAULT_USER_PROMPT),
  ]);
  console.log("[ai] Using prompts from KV (or defaults), system v%s, user v%s", system.version, user.version);

  const messages = [
    { role: "system", content: system.content },
    { role: "user", content: fill(user.content, transcriptions) },
  ];
  return runJsonCompletion(ai, cerebrasApiKey, messages, parseGeneratedSurvey, {
    properties: {
      audience: transcriptions.audience,
      gather: transcriptions.gather,
      $ai_prompt_version_system: system.version,
      $ai_prompt_version_user: user.version,
    },
  });
}

/**
 * Agent brief flow: free-form brief + clarifying Q&A → title + questions.
 */
export async function generateQuestionsFromBrief(
  ai: any,
  kv: KVNamespace,
  input: { brief: string; clarifications: { question: string; answer: string }[] },
  cerebrasApiKey?: string
): Promise<GeneratedSurvey> {
  const [system, briefPrompt] = await Promise.all([
    loadPrompt(kv, "system", DEFAULT_SYSTEM_PROMPT),
    loadPrompt(kv, "brief", DEFAULT_BRIEF_PROMPT),
  ]);

  const messages = [
    { role: "system", content: system.content },
    {
      role: "user",
      content: fill(briefPrompt.content, {
        brief: input.brief,
        clarifications: formatClarifications(input.clarifications),
      }),
    },
  ];
  return runJsonCompletion(ai, cerebrasApiKey, messages, parseGeneratedSurvey, {
    properties: {
      brief: input.brief,
      clarificationCount: input.clarifications.length,
      $ai_prompt_version_system: system.version,
      $ai_prompt_version_brief: briefPrompt.version,
    },
  });
}

// ── Swapping one question on the review screen ───────────────────────

const SWAP_PROMPT = `A creator is reviewing the questions their agent will ask the group. They want question {{index}} of {{count}} replaced with a different one.

BRIEF:
{{brief}}

CLARIFICATIONS:
{{clarifications}}

THE QUESTIONS THAT STAY (answered by voice unless noted; do not duplicate any of these):
{{others}}

THE QUESTION BEING REPLACED (the creator does not want this one; never return it or a rewording of it):
{{current}}
(its media type is "{{currentType}}")

Write ONE new question for slot {{index}}: same tone and length as the ones that stay, a genuinely different angle on the brief that none of them covers, warm and conversational as the agent would say it out loud. Keep the slot's media type unless a different one is clearly better.{{nudge}}

Return JSON: {"text": "...", "hint": "Question {{index}} of {{count}}", "type": "voice" | "photo" | "video"}.`;

/** Models sometimes copy a "[voice] …" list format from a prompt into the answer. */
function stripMediaTag(text: string): string {
  return text.trim().replace(/^[\[(](voice|photo|video)[\])]\s*/i, "").trim();
}

export type ReplacementQuestion = { text: string; hint: string; type: "voice" | "photo" | "video" };

function parseReplacementQuestion(text: string): ReplacementQuestion {
  const parsed = JSON.parse(extractJson(text)) as { text?: unknown; hint?: unknown; type?: unknown };
  const q = typeof parsed.text === "string" ? stripMediaTag(parsed.text) : "";
  if (!q) throw new Error("Replacement question missing from AI response");
  const type = parsed.type === "photo" ? "photo" : parsed.type === "video" ? "video" : "voice";
  const hint = typeof parsed.hint === "string" && parsed.hint.trim() ? parsed.hint.trim() : "";
  return { text: q, hint, type };
}

/**
 * Review-screen swap: one new question for slot `index` (0-based) that covers
 * an angle the rest of the draft doesn't. The prompt is code, not KV: it is
 * small and tied to the response shape.
 */
export async function generateReplacementQuestion(
  ai: any,
  cerebrasApiKey: string | undefined,
  input: {
    brief: string;
    clarifications: { question: string; answer: string }[];
    questions: { text: string; type?: string }[];
    index: number;
  },
  traceId?: string
): Promise<ReplacementQuestion> {
  const current = input.questions[input.index];
  const others = input.questions
    .map((q, i) => ({ q, i }))
    .filter(({ i }) => i !== input.index)
    .map(({ q, i }) => `${i + 1}. ${q.text}${q.type && q.type !== "voice" ? ` (answered by ${q.type})` : ""}`)
    .join("\n");
  const normalise = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const taken = new Set(input.questions.map((q) => normalise(q.text)));

  let replacement: ReplacementQuestion | null = null;
  // Small models sometimes hand the old question back; one retry with a blunter nudge fixes most of those.
  for (let attempt = 0; attempt < 2 && !replacement; attempt++) {
    const messages = [
      { role: "system", content: DEFAULT_SYSTEM_PROMPT },
      {
        role: "user",
        content: fill(SWAP_PROMPT, {
          index: String(input.index + 1),
          count: String(input.questions.length),
          brief: input.brief,
          clarifications: formatClarifications(input.clarifications),
          others: others || "(none)",
          current: current?.text ?? "",
          currentType: current?.type ?? "voice",
          nudge: attempt === 0 ? "" : " Your previous answer repeated the question being replaced. This one must ask about something else entirely.",
        }),
      },
    ];
    const candidate = await runJsonCompletion(ai, cerebrasApiKey, messages, parseReplacementQuestion, {
      traceId,
      maxTokens: 300,
      properties: { swapIndex: input.index, questionCount: input.questions.length, attempt },
    });
    if (!taken.has(normalise(candidate.text))) replacement = candidate;
    else if (attempt === 1) replacement = candidate; // give up gracefully rather than fail the tap
  }
  const out = replacement!;
  if (!out.hint) out.hint = `Question ${input.index + 1} of ${input.questions.length}`;
  return out;
}

// ── Rewriting the whole draft from a review-screen chip ──────────────

/** The chips on the review screen. Server-side allowlist; the instruction is what the model sees. */
export const ADJUST_KINDS = {
  shorter: "Make every question shorter and punchier: one idea each, under 15 words where you can.",
  playful: "Make the questions more playful and informal, like a friend asking, without losing what each one asks.",
} as const;
export type AdjustKind = keyof typeof ADJUST_KINDS;
export function isAdjustKind(v: unknown): v is AdjustKind {
  return typeof v === "string" && v in ADJUST_KINDS;
}

const ADJUST_PROMPT = `A creator is reviewing the questions their agent will ask the group and tapped a button to change all of them at once.

BRIEF:
{{brief}}

THE QUESTIONS, in order (answered by voice unless noted):
{{questions}}

THE CHANGE: {{instruction}}

Rewrite every question accordingly. Keep the same number of questions, the same order, and what each one asks; only the wording changes. Warm and conversational, as the agent would say them out loud.

Return JSON: {"questions": [{"text": "..."}, ...]} with exactly {{count}} items in the same order.`;

function parseAdjustedQuestions(text: string): string[] {
  const parsed = JSON.parse(extractJson(text)) as { questions?: unknown };
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error("Adjusted questions missing from AI response");
  }
  return parsed.questions.map((q) => {
    const t = typeof q === "string" ? q : typeof (q as { text?: unknown })?.text === "string" ? (q as { text: string }).text : "";
    return stripMediaTag(t);
  });
}

/**
 * Review-screen chips ("Shorter", "More playful"): rewrite the draft on
 * screen in place. Same count, order and media type; a slot the model
 * skipped keeps its old text rather than failing the tap. Cerebras answers
 * in about a second, so the review screen never has to leave.
 */
export async function adjustQuestions(
  ai: any,
  cerebrasApiKey: string | undefined,
  input: { brief: string; kind: AdjustKind; questions: { text: string; hint?: string; type?: string }[] },
  traceId?: string
): Promise<{ text: string; hint: string; type: "voice" | "photo" | "video" }[]> {
  const count = input.questions.length;
  const messages = [
    { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    {
      role: "user",
      content: fill(ADJUST_PROMPT, {
        brief: input.brief,
        instruction: ADJUST_KINDS[input.kind],
        count: String(count),
        questions: input.questions
          .map((q, i) => `${i + 1}. ${q.text}${q.type && q.type !== "voice" ? ` (answered by ${q.type})` : ""}`)
          .join("\n"),
      }),
    },
  ];
  const texts = await runJsonCompletion(ai, cerebrasApiKey, messages, parseAdjustedQuestions, {
    traceId,
    maxTokens: 900,
    properties: { adjustKind: input.kind, questionCount: count },
  });
  return input.questions.map((q, i) => ({
    text: texts[i] && texts[i].length > 0 ? texts[i] : q.text,
    hint: q.hint && q.hint.trim() ? q.hint : `Question ${i + 1} of ${count}`,
    type: q.type === "photo" ? "photo" : q.type === "video" ? "video" : "voice",
  }));
}

// ── Revising the draft with the creator's follow-up answers ───────────

const REVISE_PROMPT = `A creator is reviewing the questions their agent will ask the group. They answered a few follow-up questions about what they really want, and tapped "Update with feedback". Fold what they said into the questions.

BRIEF:
{{brief}}

WHAT THE CREATOR SAID WHEN ASKED MORE:
{{clarifications}}

THE QUESTIONS AS THEY STAND, in order (answered by voice unless noted):
{{questions}}

Revise the list so it reflects what the creator told you: reword a question that now misses the point, drop one that the answers made redundant, add one where they surfaced something the list doesn't cover, reorder if the flow improves. Keep what already works; this is an edit, not a rewrite. Stay within {{min}} to {{max}} questions. Warm and conversational, as the agent would say them out loud.

Return JSON: {"questions": [{"text": "...", "type": "voice" | "photo" | "video"}, ...]} in the order they should be asked. Keep each question's type unless the creator's answers call for a different one.`;

function parseRevisedQuestions(text: string): { text: string; type: "voice" | "photo" | "video" }[] {
  const parsed = JSON.parse(extractJson(text)) as { questions?: unknown };
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error("Revised questions missing from AI response");
  }
  return parsed.questions
    .map((q) => {
      const raw = typeof q === "string" ? q : typeof (q as { text?: unknown })?.text === "string" ? (q as { text: string }).text : "";
      const type = (q as { type?: unknown })?.type;
      return {
        text: stripMediaTag(raw).trim(),
        type: type === "photo" ? ("photo" as const) : type === "video" ? ("video" as const) : ("voice" as const),
      };
    })
    .filter((q) => q.text.length > 0);
}

/**
 * The checkpoint after "Sharpen it": the draft on the review screen edited
 * in the light of the creator's follow-up answers. Unlike `adjustQuestions`
 * the count may change (within two of the current length) and questions may
 * be added, dropped or reordered; the model is told it is an edit, not a
 * rewrite. Cerebras answers in a second or two, so the review screen shows
 * the old draft dimmed and fades the new one in.
 */
export async function reviseQuestions(
  ai: any,
  cerebrasApiKey: string | undefined,
  input: {
    brief: string;
    clarifications: { question: string; answer: string }[];
    questions: { text: string; hint?: string; type?: string }[];
  },
  traceId?: string
): Promise<{ text: string; hint: string; type: "voice" | "photo" | "video" }[]> {
  const count = input.questions.length;
  const min = Math.max(1, count - 2);
  const max = Math.min(20, count + 2);
  const messages = [
    { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    {
      role: "user",
      content: fill(REVISE_PROMPT, {
        brief: input.brief,
        clarifications: formatClarifications(input.clarifications),
        min: String(min),
        max: String(max),
        questions: input.questions
          .map((q, i) => `${i + 1}. ${q.text}${q.type && q.type !== "voice" ? ` (answered by ${q.type})` : ""}`)
          .join("\n"),
      }),
    },
  ];
  const revised = await runJsonCompletion(ai, cerebrasApiKey, messages, parseRevisedQuestions, {
    traceId,
    maxTokens: 1200,
    properties: { questionCount: count, clarificationCount: input.clarifications.length },
  });
  const kept = revised.slice(0, max);
  return kept.map((q, i) => ({ ...q, hint: `Question ${i + 1} of ${kept.length}` }));
}

// ── Clarifying questions ─────────────────────────────────────────────

export type ClarifyingQuestion = { question: string; hint: string | null };

function parseClarifyingQuestion(text: string): ClarifyingQuestion {
  const parsed = JSON.parse(extractJson(text)) as { question?: unknown; hint?: unknown };
  const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
  if (!question) throw new Error("Clarifying question missing from AI response");
  const hint = typeof parsed.hint === "string" && parsed.hint.trim() ? parsed.hint.trim() : null;
  return { question, hint };
}

/**
 * Ask Cerebras for the single most useful next clarifying question given the
 * brief and everything answered so far.
 */
export async function generateClarifyingQuestion(
  ai: any,
  kv: KVNamespace,
  input: { brief: string; history: { question: string; answer: string }[] },
  cerebrasApiKey?: string,
  traceId?: string
): Promise<ClarifyingQuestion> {
  const prompt = await loadPrompt(kv, "clarify", DEFAULT_CLARIFY_PROMPT);
  const messages = [
    { role: "system", content: CLARIFY_SYSTEM_PROMPT },
    {
      role: "user",
      content: fill(prompt.content, {
        brief: input.brief,
        clarifications: formatClarifications(input.history),
        count: String(input.history.length),
      }),
    },
  ];
  return runJsonCompletion(ai, cerebrasApiKey, messages, parseClarifyingQuestion, {
    traceId,
    maxTokens: 400,
    properties: {
      clarificationCount: input.history.length,
      $ai_prompt_version_clarify: prompt.version,
    },
  });
}

/**
 * Agent brief checklist.
 *
 * While a creator describes their research agent, the frontend streams the
 * live transcript here and we decide which of the five checklist items they
 * have covered. TypeSafe Jev answers five Noul (yes/no) questions in one
 * ~300 ms call; Cerebras / Workers AI Llama act as JSON fallbacks so the
 * checklist still works if TypeSafe is unavailable.
 *
 * The item ids and order MUST match `frontend/src/lib/briefChecklist.ts`.
 */

import type { Env } from "../types";
import { systemOne, type NoulQuestion } from "./typesafe";
import { runJsonCompletion } from "./ai";

export type BriefItemId = "audience" | "goal" | "purpose" | "tone" | "length";

export interface BriefChecklistItem {
  id: BriefItemId;
  label: string;
  question: NoulQuestion;
}

export const BRIEF_CHECKLIST: BriefChecklistItem[] = [
  {
    id: "audience",
    label: "Who you'll talk to",
    question: {
      type: "noul",
      instructions:
        "Does the transcript say WHO the agent will interview: a specific group of people (for example customers of a product, new hires, runners, parents)?",
      criteria: {
        true: "A concrete audience or participant group is named or described",
        false: "No audience is mentioned, or only vague words like people or users with no further detail",
      },
    },
  },
  {
    id: "goal",
    label: "What you want to learn",
    question: {
      type: "noul",
      instructions: "Does the transcript say WHAT the creator wants to learn, find out, or ask about?",
      criteria: {
        true: "A topic, research question, or type of information to gather is stated",
        false: "Nothing about what to learn or ask is mentioned",
      },
    },
  },
  {
    id: "purpose",
    label: "Why it matters",
    question: {
      type: "noul",
      instructions:
        "Does the transcript explain WHY the creator wants this information: the decision, product, project, or outcome the answers will feed into?",
      criteria: {
        true: "A reason, decision, or use for the answers is given",
        false: "No reason or use for the answers is mentioned",
      },
    },
  },
  {
    id: "tone",
    label: "How it should sound",
    question: {
      type: "noul",
      instructions:
        "Does the transcript describe HOW the agent should come across: its tone, personality, formality, or style (for example friendly, professional, playful, concise)?",
      criteria: {
        true: "A tone, personality, style, or manner of speaking is described",
        false: "Nothing about tone, personality, or style is mentioned",
      },
    },
  },
  {
    id: "length",
    label: "How long it should take",
    question: {
      type: "noul",
      instructions:
        "Does the transcript say how LONG the interview should be: a number of questions, a duration in minutes, or a clear preference for quick versus in-depth?",
      criteria: {
        true: "A number of questions, a duration, or a clear length preference is stated",
        false: "Nothing about length, duration, or number of questions is mentioned",
      },
    },
  },
];

/** Noul probability at or above which an item counts as covered. */
export const BRIEF_SATISFIED_THRESHOLD = 0.7;
/** Don't bother the model with a transcript shorter than this. */
export const BRIEF_MIN_CHARS = 12;
/** Hard cap so a runaway transcript can't blow the model context. */
export const BRIEF_MAX_CHARS = 20_000;

export interface BriefItemResult {
  id: BriefItemId;
  satisfied: boolean;
  probability: number;
}

export interface BriefEvaluation {
  items: BriefItemResult[];
  complete: boolean;
  provider: "typesafe" | "cerebras" | "cloudflare-workers-ai" | "none";
  model: string | null;
}

const STATE_CONTEXT =
  "A creator is describing, by voice, the research agent (an AI voice interviewer) they want to build. The transcript may be incomplete because they are still talking.";

function emptyEvaluation(): BriefEvaluation {
  return {
    items: BRIEF_CHECKLIST.map((item) => ({ id: item.id, satisfied: false, probability: 0 })),
    complete: false,
    provider: "none",
    model: null,
  };
}

function finish(
  probabilities: Record<BriefItemId, number>,
  provider: BriefEvaluation["provider"],
  model: string | null
): BriefEvaluation {
  const items = BRIEF_CHECKLIST.map((item) => {
    const probability = clamp01(probabilities[item.id]);
    return { id: item.id, satisfied: probability >= BRIEF_SATISFIED_THRESHOLD, probability };
  });
  return { items, complete: items.every((i) => i.satisfied), provider, model };
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Decide which checklist items the transcript already covers.
 */
export async function evaluateBrief(
  env: Env,
  transcriptRaw: string,
  traceId: string
): Promise<BriefEvaluation> {
  const transcript = transcriptRaw.trim().slice(0, BRIEF_MAX_CHARS);
  if (transcript.length < BRIEF_MIN_CHARS) return emptyEvaluation();

  const state = { context: STATE_CONTEXT, transcript };

  // 1. TypeSafe Jev — the intended path.
  if (env.TYPESAFE_API_KEY) {
    try {
      const questions = Object.fromEntries(
        BRIEF_CHECKLIST.map((item) => [item.id, item.question])
      ) as Record<BriefItemId, NoulQuestion>;
      const result = await systemOne(env.TYPESAFE_API_KEY, state, questions, {
        traceId,
        properties: { purpose: "brief-checklist", transcriptChars: transcript.length },
      });
      const probabilities = Object.fromEntries(
        BRIEF_CHECKLIST.map((item) => [item.id, result.answers[item.id]?.noul ?? 0])
      ) as Record<BriefItemId, number>;
      return finish(probabilities, "typesafe", result.model);
    } catch (err) {
      console.error("[brief] TypeSafe evaluation failed, falling back:", err);
    }
  }

  // 2. Cerebras → Workers AI Llama, asking for booleans in JSON.
  const rubric = BRIEF_CHECKLIST.map(
    (item) =>
      `- "${item.id}": ${item.question.instructions} YES means: ${item.question.criteria?.true}. NO means: ${item.question.criteria?.false}.`
  ).join("\n");
  const messages = [
    {
      role: "system",
      content:
        "You judge whether a spoken brief covers specific points. Be strict: only say true when the transcript clearly covers the point. Always respond in valid JSON.",
    },
    {
      role: "user",
      content: `${STATE_CONTEXT}\n\nTRANSCRIPT:\n${transcript}\n\nFor each key below answer true or false.\n${rubric}\n\nReturn JSON with exactly these keys: ${BRIEF_CHECKLIST.map((i) => `"${i.id}"`).join(", ")} and boolean values.`,
    },
  ];

  try {
    const { values, provider } = await runJsonCompletion(
      env.AI,
      env.CEREBRAS_API_KEY,
      messages,
      (text) => {
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const parsed = JSON.parse(match ? match[1].trim() : text) as Record<string, unknown>;
        const values = Object.fromEntries(
          BRIEF_CHECKLIST.map((item) => [item.id, parsed[item.id] === true ? 1 : 0])
        ) as Record<BriefItemId, number>;
        // Cerebras is tried first; if we got here via Llama the model name is
        // reported in the $ai_generation event, so a rough label suffices.
        return { values, provider: env.CEREBRAS_API_KEY ? "cerebras" : "cloudflare-workers-ai" } as const;
      },
      { traceId, maxTokens: 200, properties: { purpose: "brief-checklist-fallback" } }
    );
    return finish(values, provider, null);
  } catch (err) {
    console.error("[brief] All evaluators failed:", err);
    return emptyEvaluation();
  }
}

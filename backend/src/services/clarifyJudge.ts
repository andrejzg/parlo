/**
 * Jev judges Cerebras.
 *
 * Every clarifying question Cerebras produces is scored by TypeSafe Jev on
 * three Noul questions, off the request path (waitUntil), so we can see the
 * follow-up failure modes without a human reading each one:
 *   redundant    — the brief or earlier answers already cover it
 *   misaddressed — worded at a participant instead of the creator
 *   vague        — too generic to change the interview
 * Results land on the survey trace in PostHog ($ai_generation), as a
 * `clarify_question_judged` event, and in the creation log (`clarify_judged`).
 */

import type { Env } from "../types";
import { systemOne, type NoulQuestion } from "./typesafe";

export const CLARIFY_JUDGE_THRESHOLD = 0.7;

export interface ClarifyJudgement {
  redundant: number;
  misaddressed: number;
  vague: number;
  flagged: boolean;
  flags: ("redundant" | "misaddressed" | "vague")[];
  model: string;
}

const JUDGE_QUESTIONS: Record<"redundant" | "misaddressed" | "vague", NoulQuestion> = {
  redundant: {
    type: "noul",
    instructions:
      "Is `candidate_question` already answered by `brief` or by `clarifications_so_far`, so that asking it would make the creator repeat themselves?",
    criteria: {
      true: "The information the question asks for is clearly stated in the brief or an earlier answer",
      false: "The question asks for something not yet covered, or digs meaningfully deeper than what was said",
    },
  },
  misaddressed: {
    type: "noul",
    instructions:
      "Is `candidate_question` worded as if it were asking a research participant about their own experience, instead of asking the creator (the person commissioning the research) about what they need?",
    criteria: {
      true: "It asks 'you' about the experience the participants had, e.g. 'how did the setup feel for you?'",
      false: "It asks the creator about their goals, audience, constraints, or what they want to learn",
    },
  },
  vague: {
    type: "noul",
    instructions:
      "Is `candidate_question` too generic to change how the interview would be designed, such that any answer would leave the interview questions the same?",
    criteria: {
      true: "A boilerplate question that could be asked of any brief and whose answer would not alter the interview",
      false: "A specific question whose answer would plausibly add, remove, or reshape interview questions",
    },
  },
};

export async function judgeClarifyingQuestion(
  env: Env,
  input: { brief: string; history: { question: string; answer: string }[]; question: string; index: number },
  traceId: string
): Promise<ClarifyJudgement | null> {
  if (!env.TYPESAFE_API_KEY) return null;
  try {
    const result = await systemOne(
      env.TYPESAFE_API_KEY,
      {
        context:
          "A creator is setting up an AI voice interviewer. An assistant just proposed a clarifying question to ask the creator. Judge the proposed question.",
        brief: input.brief,
        clarifications_so_far: input.history,
        candidate_question: input.question,
      },
      JUDGE_QUESTIONS,
      { traceId, properties: { purpose: "clarify-judge", index: input.index } }
    );
    const redundant = result.answers.redundant?.noul ?? 0;
    const misaddressed = result.answers.misaddressed?.noul ?? 0;
    const vague = result.answers.vague?.noul ?? 0;
    const flags = (["redundant", "misaddressed", "vague"] as const).filter(
      (k) => ({ redundant, misaddressed, vague })[k] >= CLARIFY_JUDGE_THRESHOLD
    );
    return { redundant, misaddressed, vague, flagged: flags.length > 0, flags, model: result.model };
  } catch (err) {
    console.error("[clarify-judge] failed:", err);
    return null;
  }
}

/**
 * The shapes a parlo's answer can take, and how each one turns into the
 * brief the question generator and the group agent work from. The creator
 * picks a shape, an audience and a length on the phone and fills one blank
 * (the topic); `composeBrief()` turns those four into the prose brief that
 * `/generate`, `/clarify` and the agent's `/brief.md` already expect.
 *
 * Ids and order MUST match `frontend/src/lib/shapes.ts`.
 */
export type ShapeId = "decide" | "rank" | "temperature" | "ideas" | "stories" | "feedback" | "headcount" | "other";
export type AudienceId = "group" | "friends" | "team" | "customers" | "community" | "strangers";
export type LengthId = "one" | "few" | "deep";

interface ShapeSpec {
  id: ShapeId;
  /** The sentence the creator completed. `{who}` is the audience; the topic follows. */
  sentence: string;
  /** What the agent hands back to the group. */
  report: string;
  /** How the questions should work for this shape. */
  questions: string;
}

export const SHAPES: ShapeSpec[] = [
  {
    id: "decide",
    sentence: "Help {who} decide",
    report: "The group's pick, the runner-up, and why.",
    questions:
      "The group has to pick one option. Find out what the options are and what matters in choosing, then each person's pick and why; close by asking what would change their mind.",
  },
  {
    id: "rank",
    sentence: "Get {who} to rank",
    report: "A ranked list, with how many put each thing first.",
    questions:
      "Ask for each person's order and the reasoning behind their top and bottom choice. Keep answers comparable across people so they can be tallied.",
  },
  {
    id: "temperature",
    sentence: "Take the temperature of {who} on",
    report: "Where the group stands, the split, and what's behind it.",
    questions:
      "Find out where each person stands, how strongly, and what is behind it. One question should surface worries or objections.",
  },
  {
    id: "ideas",
    sentence: "Collect ideas from {who} for",
    report: "Every idea, grouped, with the ones that came up most.",
    questions:
      "Draw out as many concrete ideas as possible. Ask for their best idea and a wild one, and what would make an idea a winner.",
  },
  {
    id: "stories",
    sentence: "Hear stories from {who} about",
    report: "The themes across everyone's stories, with the lines that stuck.",
    questions:
      "Ask for specific moments, not opinions: what happened, what it felt like, what they took from it. Follow the arc of a story.",
  },
  {
    id: "feedback",
    sentence: "Get honest feedback from {who} on",
    report: "What works and what to fix, in order of how often it came up.",
    questions:
      "Start with the gut reaction, then what works, what to fix and what is missing, as concretely as possible. Make it safe to be blunt.",
  },
  {
    id: "headcount",
    sentence: "Count {who} in or out for",
    report: "Who's in, who's out, who's unsure, and what they need.",
    questions:
      "Find out whether each person is in, what would stop them, and what they need to make it work. Keep it to very few questions.",
  },
  {
    id: "other",
    sentence: "",
    report: "A report on what the group said.",
    questions: "",
  },
];

const AUDIENCES: Record<AudienceId, { phrase: string; tone: string }> = {
  group: { phrase: "the group", tone: "Warm and conversational." },
  friends: { phrase: "my friends and family", tone: "Like a friend asking: warm, informal, a little playful." },
  team: { phrase: "my team", tone: "Warm and direct, between colleagues; no corporate tone." },
  customers: {
    phrase: "my customers",
    tone: "Friendly and respectful, like a founder who genuinely wants to know; never salesy.",
  },
  community: {
    phrase: "my community",
    tone: "Welcoming and inclusive; assume people don't all know each other.",
  },
  strangers: {
    phrase: "people I don't know yet",
    tone: "Polite and clear; assume no shared context.",
  },
};

const LENGTHS: Record<LengthId, { questions: number; note: string }> = {
  one: { questions: 1, note: "exactly 1 question, under a minute to answer" },
  few: { questions: 4, note: "exactly 4 questions, about three minutes to answer" },
  deep: { questions: 8, note: "exactly 8 questions, a proper conversation of ten minutes or so" },
};

export const SHAPE_IDS = SHAPES.map((s) => s.id);
export const AUDIENCE_IDS = Object.keys(AUDIENCES) as AudienceId[];
export const LENGTH_IDS = Object.keys(LENGTHS) as LengthId[];
export const TOPIC_MAX_CHARS = 300;

export function isShapeId(v: unknown): v is ShapeId {
  return typeof v === "string" && (SHAPE_IDS as string[]).includes(v);
}
export function isAudienceId(v: unknown): v is AudienceId {
  return typeof v === "string" && (AUDIENCE_IDS as string[]).includes(v);
}
export function isLengthId(v: unknown): v is LengthId {
  return typeof v === "string" && (LENGTH_IDS as string[]).includes(v);
}

export function shapeReport(id: string | null | undefined): string | null {
  if (!id) return null;
  return SHAPES.find((s) => s.id === id)?.report ?? null;
}

export interface ShapeInput {
  shape: Exclude<ShapeId, "other">;
  audience: AudienceId;
  length: LengthId;
  topic: string;
}

/** The prose brief the pipeline works from, assembled from the creator's taps and the one blank they filled. */
export function composeBrief(input: ShapeInput): string {
  const shape = SHAPES.find((s) => s.id === input.shape)!;
  const audience = AUDIENCES[input.audience];
  const length = LENGTHS[input.length];
  const sentence = `${shape.sentence.replace("{who}", audience.phrase)} ${input.topic.trim()}`.replace(/\s+/g, " ").trim();
  return [
    sentence.endsWith(".") ? sentence : `${sentence}.`,
    "",
    `What should come back to the group: ${shape.report}`,
    `Who they are: ${audience.phrase}. Tone: ${audience.tone}`,
    `How the questions should work: ${shape.questions}`,
    `Length: ${length.note}.`,
  ].join("\n");
}

export function questionCountFor(length: LengthId): number {
  return LENGTHS[length].questions;
}

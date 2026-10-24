/**
 * The shapes a parlo's answer can take, and how each one turns into the
 * brief the question generator and the group agent work from. The creator
 * picks a shape, an audience and a length on the phone and fills one blank
 * (the topic); `composeBrief()` turns those four into the prose brief that
 * `/generate`, `/clarify` and the agent's `/brief.md` already expect.
 *
 * Ids MUST match `frontend/src/lib/shapes.ts`. The deck was rewritten for
 * founders and tech operators on 2026-10-24 (GROWTH.md, 2026-10-23); the
 * retired shapes stay below, marked `retired`, so parlos made before then
 * keep their report shape and a cached old frontend can still build.
 */
import { outputsBriefLines, type OutputId } from "./outputs";

export type ShapeId =
  | "post"
  | "testimonials"
  | "milestone"
  | "validate"
  | "customers"
  | "feedback"
  | "team"
  | "references"
  | "decide"
  | "rank"
  | "temperature"
  | "ideas"
  | "stories"
  | "headcount"
  | "other";
export type AudienceId = "group" | "network" | "friends" | "team" | "customers" | "community" | "strangers";
export type LengthId = "one" | "few" | "deep";

interface ShapeSpec {
  id: ShapeId;
  /** The sentence the creator completed. `{who}` is the audience; the topic follows. No `{who}` = `who` below names them. */
  sentence: string;
  /** Who answers, when the shape fixes it rather than the audience chips. */
  who?: string;
  /** What the agent hands back to the group. */
  report: string;
  /** How the questions should work for this shape. */
  questions: string;
  /** No longer on the deck; kept for parlos that already use it. */
  retired?: boolean;
}

export const SHAPES: ShapeSpec[] = [
  {
    id: "post",
    sentence: "Crowdsource a post from {who} on",
    report: "A LinkedIn post built from everyone's best lines, ready to copy, then the themes behind it.",
    questions:
      "The answers become a LinkedIn post the creator publishes. Ask for one sharp opinion or concrete lesson, a specific example from their own experience, and a line they would be happy to be quoted on. Every answer should stand alone as a quote.",
  },
  {
    id: "testimonials",
    sentence: "Collect testimonials from {who} for",
    report: "The strongest quotes, ready for a post or your site, with who said them.",
    questions:
      "Ask what working together changed for them, one specific result or moment, and how they would describe it to a peer. Aim for warm, specific, quotable lines, and never lead them into praise.",
  },
  {
    id: "milestone",
    sentence: "Celebrate a milestone with {who}:",
    report: "A post celebrating it in their words, with the lines that stuck.",
    questions:
      "The answers become a post celebrating the milestone. Ask for a memory or moment along the way, what it meant to them, and one line for the post. Warm and specific.",
  },
  {
    id: "validate",
    sentence: "Validate an idea with {who}:",
    report: "Whether people want it, what they'd pay, and what would stop them.",
    questions:
      "Test the idea without pitching it: how they handle the problem today, what it costs them, how they react to the idea, and what they would pay. No leading questions; past behaviour beats predictions.",
  },
  {
    id: "customers",
    sentence: "Interview {who} about",
    report: "Why they chose you, in their words, with the patterns across everyone.",
    questions:
      "Ask why they chose you over the alternatives, what nearly stopped them, and what they would tell a peer. Specific moments over opinions.",
  },
  {
    id: "feedback",
    sentence: "Get honest feedback from {who} on",
    report: "What works and what to fix, in order of how often it came up.",
    questions:
      "Start with the gut reaction, then what works, what to fix and what is missing, as concretely as possible. Make it safe to be blunt.",
  },
  {
    id: "team",
    sentence: "Ask {who}",
    report: "What the team said, grouped, with what to fix first.",
    questions:
      "Make it safe to be candid: what is slowing them down, what they would change first, and what is working. Specific examples over complaints.",
  },
  {
    id: "references",
    sentence: "Check references for",
    who: "people who have worked with the candidate",
    report: "Where the references agree, where they differ, and any flags.",
    questions:
      "The people answering worked with a candidate. Ask how they worked together, the candidate's strengths, where they needed support, and whether they would work with them again. Neutral, never leading.",
  },
  {
    retired: true,
    id: "decide",
    sentence: "Help {who} decide",
    report: "The group's pick, the runner-up, and why.",
    questions:
      "The group has to pick one option. Find out what the options are and what matters in choosing, then each person's pick and why; close by asking what would change their mind.",
  },
  {
    retired: true,
    id: "rank",
    sentence: "Get {who} to rank",
    report: "A ranked list, with how many put each thing first.",
    questions:
      "Ask for each person's order and the reasoning behind their top and bottom choice. Keep answers comparable across people so they can be tallied.",
  },
  {
    retired: true,
    id: "temperature",
    sentence: "Take the temperature of {who} on",
    report: "Where the group stands, the split, and what's behind it.",
    questions:
      "Find out where each person stands, how strongly, and what is behind it. One question should surface worries or objections.",
  },
  {
    retired: true,
    id: "ideas",
    sentence: "Collect ideas from {who} for",
    report: "Every idea, grouped, with the ones that came up most.",
    questions:
      "Draw out as many concrete ideas as possible. Ask for their best idea and a wild one, and what would make an idea a winner.",
  },
  {
    retired: true,
    id: "stories",
    sentence: "Hear stories from {who} about",
    report: "The themes across everyone's stories, with the lines that stuck.",
    questions:
      "Ask for specific moments, not opinions: what happened, what it felt like, what they took from it. Follow the arc of a story.",
  },
  {
    retired: true,
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
  network: {
    phrase: "my network",
    tone: "Peer to peer, like a founder asking other founders and operators: direct, curious, no fluff.",
  },
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
  /** What the agent should make beyond the report; shapes the asks (services/outputs.ts). */
  outputs?: OutputId[];
}

/** The prose brief the pipeline works from, assembled from the creator's taps and the one blank they filled. */
export function composeBrief(input: ShapeInput): string {
  const shape = SHAPES.find((s) => s.id === input.shape)!;
  const audience = AUDIENCES[input.audience];
  const length = LENGTHS[input.length];
  const sentence = `${shape.sentence.replace("{who}", audience.phrase)} ${input.topic.trim()}`.replace(/\s+/g, " ").trim();
  const who = shape.who ? `${shape.who}. Tone: Polite and clear; assume no shared context.` : `${audience.phrase}. Tone: ${audience.tone}`;
  return [
    /[.?!]$/.test(sentence) ? sentence : `${sentence}.`,
    "",
    `What should come back to the group: ${shape.report}`,
    `Who they are: ${who}`,
    `How the questions should work: ${shape.questions}`,
    `Length: ${length.note}.`,
    ...outputsBriefLines(input.outputs ?? []),
  ].join("\n");
}

export function questionCountFor(length: LengthId): number {
  return LENGTHS[length].questions;
}

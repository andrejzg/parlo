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
  | "checkin"
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
/** The third chip row's kind: which question the shape asks (none for a one-shot shape). */
export type TimingRowId = "deadline" | "cadence" | "followup";
/** A chip on that row. `today | week | open` on the deadline row, `daily | weekly` on cadence, `once | probe` on follow-up. */
export type TimingId = "today" | "week" | "open" | "daily" | "weekly" | "once" | "probe";

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
  /** The third chip row on the sentence screen, when the shape has one (services/shapes.ts TIMINGS). */
  timing?: TimingRowId;
  /** No longer on the deck; kept for parlos that already use it. */
  retired?: boolean;
}

export const SHAPES: ShapeSpec[] = [
  {
    id: "post",
    timing: "deadline",
    sentence: "Crowdsource a post from {who}",
    report: "A LinkedIn post built from everyone's best lines, ready to copy, then the themes behind it.",
    questions:
      "The answers become a LinkedIn post the creator publishes. Ask for one sharp opinion or concrete lesson, a specific example from their own experience, and a line they would be happy to be quoted on. Every answer should stand alone as a quote.",
  },
  {
    id: "testimonials",
    timing: "deadline",
    sentence: "Collect testimonials from {who}",
    report: "The strongest quotes, ready for a post or your site, with who said them.",
    questions:
      "Ask what working together changed for them, one specific result or moment, and how they would describe it to a peer. Aim for warm, specific, quotable lines, and never lead them into praise.",
  },
  {
    id: "milestone",
    timing: "deadline",
    sentence: "Celebrate a milestone with {who}",
    report: "A post celebrating it in their words, with the lines that stuck.",
    questions:
      "The answers become a post celebrating the milestone. Ask for a memory or moment along the way, what it meant to them, and one line for the post. Warm and specific.",
  },
  {
    id: "checkin",
    timing: "cadence",
    sentence: "Run a regular check-in with {who}",
    report: "Who's on track, what's blocked, and what needs you. Same shape every round, so weeks compare.",
    questions:
      "A recurring check-in, a standup by voice. Keep it short and the same shape every round so answers compare week to week: what moved since last time, what is blocked, what they need from the creator. Answerable in a minute; no retrospectives.",
  },
  {
    id: "customers",
    timing: "followup",
    sentence: "Interview {who}",
    report: "Why they chose you, in their words, with the patterns across everyone.",
    questions:
      "Ask why they chose you over the alternatives, what nearly stopped them, and what they would tell a peer. Specific moments over opinions.",
  },
  {
    id: "feedback",
    timing: "deadline",
    sentence: "Get honest feedback from {who}",
    report: "What works and what to fix, in order of how often it came up.",
    questions:
      "Start with the gut reaction, then what works, what to fix and what is missing, as concretely as possible. Make it safe to be blunt.",
  },
  {
    id: "team",
    timing: "deadline",
    sentence: "Ask {who}",
    report: "What the team said, grouped, with what to fix first.",
    questions:
      "Make it safe to be candid: what is slowing them down, what they would change first, and what is working. Specific examples over complaints.",
  },
  {
    id: "references",
    sentence: "Check references",
    who: "people who have worked with the candidate",
    report: "Where the references agree, where they differ, and any flags.",
    questions:
      "The people answering worked with a candidate. Ask how they worked together, the candidate's strengths, where they needed support, and whether they would work with them again. Neutral, never leading.",
  },
  {
    id: "validate",
    sentence: "Validate an idea with {who}:",
    report: "Whether people want it, what they'd pay, and what would stop them.",
    questions:
      "Test the idea without pitching it: how they handle the problem today, what it costs them, how they react to the idea, and what they would pay. No leading questions; past behaviour beats predictions.",
    retired: true,
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

/**
 * The third chip row (2026-10-25): one question per shape, only where the chip
 * changes what the agent does. `delayMs` is how long a sent round stays open
 * (null = no close); `nudgeLeadMs` is how long before the close the members
 * who have not answered are reminded; `brief` goes into the composed brief.
 */
export interface TimingSpec {
  id: TimingId;
  row: TimingRowId;
  delayMs: number | null;
  nudgeLeadMs: number | null;
  brief: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const TIMINGS: TimingSpec[] = [
  { id: "today", row: "deadline", delayMs: DAY, nudgeLeadMs: 4 * HOUR, brief: "Answers close in 24 hours and the report lands then; keep the asks quick to answer." },
  { id: "week", row: "deadline", delayMs: 7 * DAY, nudgeLeadMs: DAY, brief: "Answers close in a week and the report lands then." },
  { id: "open", row: "deadline", delayMs: null, nudgeLeadMs: null, brief: "There is no deadline; the report updates as answers come in." },
  { id: "daily", row: "cadence", delayMs: DAY, nudgeLeadMs: 4 * HOUR, brief: "This is a daily check-in: the round closes after a day, the report lands, and the next round goes out with the same asks so days compare." },
  { id: "weekly", row: "cadence", delayMs: 7 * DAY, nudgeLeadMs: DAY, brief: "This is a weekly check-in: the round closes after a week, the report lands, and the next round goes out with the same asks so weeks compare." },
  { id: "once", row: "followup", delayMs: null, nudgeLeadMs: null, brief: "One round only: there will be no follow-up, so cover everything in these asks." },
  { id: "probe", row: "followup", delayMs: null, nudgeLeadMs: null, brief: "After this round the agent may follow up with individual members, so these asks can stay broad; the probes go deep." },
];

export const TIMING_ROWS: Record<TimingRowId, { defaultId: TimingId }> = {
  deadline: { defaultId: "week" },
  cadence: { defaultId: "weekly" },
  followup: { defaultId: "once" },
};

export function isTimingId(v: unknown): v is TimingId {
  return typeof v === "string" && TIMINGS.some((t) => t.id === v);
}

export function timingSpec(id: string | null | undefined): TimingSpec | null {
  return TIMINGS.find((t) => t.id === id) ?? null;
}

/** The chip a request sent, if it belongs to the shape's row; the row's default when it sent nothing; null when the shape has no row. */
export function resolveTiming(shape: ShapeId, v: unknown): TimingId | null {
  const row = SHAPES.find((s) => s.id === shape)?.timing;
  if (!row) return null;
  if (isTimingId(v) && timingSpec(v)?.row === row) return v;
  return TIMING_ROWS[row].defaultId;
}

/** When a round sent now should close, or null when it stays open. */
export function closesAtFor(timing: string | null | undefined, from: Date = new Date()): Date | null {
  const spec = timingSpec(timing);
  if (!spec?.delayMs) return null;
  return new Date(from.getTime() + spec.delayMs);
}

/** Whether the agent should propose the next round itself when this one closes (the check-in cadence). */
export function repeatsOnClose(timing: string | null | undefined): boolean {
  return timingSpec(timing)?.row === "cadence";
}

/** Whether the agent may propose probe rounds without being asked. */
export function allowsProbes(timing: string | null | undefined): boolean {
  return timing === "probe";
}

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
  /** Optional since 2026-10-25: the creation screen has no blank any more. Old parlos and API callers may still send one. */
  topic?: string;
  /** What the agent should make beyond the report; shapes the asks (services/outputs.ts). */
  outputs?: OutputId[];
  /** The third chip row's pick, when the shape has one. */
  timing?: TimingId | null;
}

/** The prose brief the pipeline works from, assembled from the creator's taps and the one blank they filled. */
export function composeBrief(input: ShapeInput): string {
  const shape = SHAPES.find((s) => s.id === input.shape)!;
  const audience = AUDIENCES[input.audience];
  const length = LENGTHS[input.length];
  const sentence = `${shape.sentence.replace("{who}", audience.phrase)} ${(input.topic ?? "").trim()}`.replace(/\s+/g, " ").trim();
  const who = shape.who ? `${shape.who}. Tone: Polite and clear; assume no shared context.` : `${audience.phrase}. Tone: ${audience.tone}`;
  return [
    /[.?!]$/.test(sentence) ? sentence : `${sentence}.`,
    "",
    `What should come back to the group: ${shape.report}`,
    `Who they are: ${who}`,
    `How the questions should work: ${shape.questions}`,
    `Length: ${length.note}.`,
    ...(timingSpec(input.timing) ? [`Timing: ${timingSpec(input.timing)!.brief}`] : []),
    ...outputsBriefLines(input.outputs ?? []),
  ].join("\n");
}

export function questionCountFor(length: LengthId): number {
  return LENGTHS[length].questions;
}

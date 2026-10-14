/**
 * The shapes a parlo's answer can take. Creation starts here: the creator
 * picks what they want back from the group ("Decide", "Rank", "Take the
 * temperature"…), then fills the one blank the shape leaves in its sentence.
 * Shapes are finite and any topic maps onto one; they are deliberately not
 * use-case templates (see GROWTH.md, 2026-10-12).
 *
 * Ids and order MUST match `backend/src/services/shapes.ts`, which composes
 * the brief the model builds the questions from and tells the agent what
 * the report should look like.
 */
export type ShapeId = "decide" | "rank" | "temperature" | "ideas" | "stories" | "feedback" | "headcount" | "other";
export type AudienceId = "group" | "friends" | "team" | "customers" | "community" | "strangers";
export type LengthId = "one" | "few" | "deep";

export interface Shape {
  id: ShapeId;
  /** The verb on the card. */
  label: string;
  /** The example under the verb; also the blank's placeholder. */
  example: string;
  /** The sentence the card starts. `{who}` is the audience; the blank follows the sentence. */
  sentence: string;
  /** What the agent hands back to the group. Shown on review; the agent commits to it. */
  report: string;
}

export const SHAPES: Shape[] = [
  {
    id: "decide",
    label: "Decide",
    example: "where to go for the offsite",
    sentence: "Help {who} decide",
    report: "The group's pick, the runner-up, and why.",
  },
  {
    id: "rank",
    label: "Rank",
    example: "our priorities for next quarter",
    sentence: "Get {who} to rank",
    report: "A ranked list, with how many put each thing first.",
  },
  {
    id: "temperature",
    label: "Take the temperature",
    example: "the new offsite plan",
    sentence: "Take the temperature of {who} on",
    report: "Where the group stands, the split, and what's behind it.",
  },
  {
    id: "ideas",
    label: "Collect ideas",
    example: "the Christmas party",
    sentence: "Collect ideas from {who} for",
    report: "Every idea, grouped, with the ones that came up most.",
  },
  {
    id: "stories",
    label: "Hear stories",
    example: "their first week here",
    sentence: "Hear stories from {who} about",
    report: "The themes across everyone's stories, with the lines that stuck.",
  },
  {
    id: "feedback",
    label: "Get feedback",
    example: "my pitch deck",
    sentence: "Get honest feedback from {who} on",
    report: "What works and what to fix, in order of how often it came up.",
  },
  {
    id: "headcount",
    label: "Head count",
    example: "the ski trip",
    sentence: "Count {who} in or out for",
    report: "Who's in, who's out, who's unsure, and what they need.",
  },
  {
    id: "other",
    label: "Something else",
    example: "describe it in your own words",
    sentence: "",
    report: "A report on what the group said.",
  },
];

export function shapeById(id: ShapeId): Shape {
  return SHAPES.find((s) => s.id === id) ?? SHAPES[SHAPES.length - 1];
}

/** `group` is the unselected default ("the group"); the rest are the chips. */
export const AUDIENCES: { id: AudienceId; label: string; phrase: string }[] = [
  { id: "group", label: "The group", phrase: "the group" },
  { id: "friends", label: "Friends and family", phrase: "my friends and family" },
  { id: "team", label: "My team", phrase: "my team" },
  { id: "customers", label: "My customers", phrase: "my customers" },
  { id: "community", label: "My community", phrase: "my community" },
  { id: "strangers", label: "People I don't know yet", phrase: "people I don't know yet" },
];

export const DEFAULT_AUDIENCE: AudienceId = "group";

export function audiencePhrase(id: AudienceId): string {
  return (AUDIENCES.find((a) => a.id === id) ?? AUDIENCES[0]).phrase;
}

export const LENGTHS: { id: LengthId; label: string }[] = [
  { id: "one", label: "One question" },
  { id: "few", label: "A few minutes" },
  { id: "deep", label: "Deep dive" },
];

export const DEFAULT_LENGTH: LengthId = "few";

/** The sentence with the audience dropped in, split around the audience so it can be styled: [before, who, after]. */
export function sentenceParts(shape: Shape, audience: AudienceId): [string, string, string] {
  const [before = "", after = ""] = shape.sentence.split("{who}");
  return [before, audiencePhrase(audience), after];
}

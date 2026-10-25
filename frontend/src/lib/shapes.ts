/**
 * The shapes a parlo can take. Creation starts here: the creator picks what
 * they want to find out ("Crowdsource a post", "Collect testimonials"…),
 * then fills the one blank the shape leaves in its sentence. The deck is
 * written for the wedge, founders and tech operators who post on LinkedIn a
 * lot, and leads with self-promotion (GROWTH.md, 2026-10-23). Six cards sit
 * on the first screen; the rest wait behind "More".
 *
 * Ids MUST match `backend/src/services/shapes.ts`, which composes the brief
 * the model builds the questions from and tells the agent what the report
 * should look like. The backend also keeps the retired ids (decide, rank…)
 * so parlos made before 2026-10-24 keep their report shape; "validate" joined them on 2026-10-25.
 */
import type { OutputId } from "./outputs";

export type ShapeId =
  | "post"
  | "testimonials"
  | "milestone"
  | "customers"
  | "feedback"
  | "checkin"
  | "team"
  | "references"
  | "other";
export type AudienceId = "group" | "network" | "customers" | "team" | "strangers" | "community" | "friends";
export type LengthId = "one" | "few" | "deep";

export interface Shape {
  id: ShapeId;
  /** The verb on the card. */
  label: string;
  /** The line under the verb on the card; reads on from the label. */
  card: string;
  /** The sentence the card starts, shown as the heading of the next screen. `{who}` is the audience chip; no `{who}` = the audience is fixed and the chips are hidden. The blank it used to end in went on 2026-10-25: the screen is taps only. */
  sentence: string;
  /** What the agent hands back. Shown on review; the agent commits to it. */
  report: string;
  /** Who the creator is most likely asking; pre-selects the chip. */
  audience: AudienceId;
  /** What the agent makes beyond the report; pre-selects the output cards. */
  outputs: OutputId[];
  /** On the first screen, or behind "More". */
  more?: boolean;
}

export const SHAPES: Shape[] = [
  {
    id: "post",
    label: "Crowdsource a post",
    card: "on how founders hire engineer #1",
    sentence: "Crowdsource a post from {who}",
    report: "A LinkedIn post built from everyone's best lines, ready to copy, then the themes behind it.",
    audience: "network",
    outputs: ["sheet", "linkedin"],
  },
  {
    id: "testimonials",
    label: "Collect testimonials",
    card: "from clients, for your launch post",
    sentence: "Collect testimonials from {who}",
    report: "The strongest quotes, ready for a post or your site, with who said them.",
    audience: "customers",
    outputs: ["sheet", "linkedin"],
  },
  {
    id: "milestone",
    label: "Celebrate a milestone",
    card: "our first 100 customers, in their words",
    sentence: "Celebrate a milestone with {who}",
    report: "A post celebrating it in their words, with the lines that stuck.",
    audience: "customers",
    outputs: ["sheet", "linkedin"],
  },
  {
    id: "feedback",
    label: "Get feedback",
    card: "on my pitch deck",
    sentence: "Get honest feedback from {who}",
    report: "What works and what to fix, in order of how often it came up.",
    audience: "network",
    outputs: ["sheet"],
  },
  {
    id: "customers",
    label: "Interview customers",
    card: "about why they picked you",
    sentence: "Interview {who}",
    report: "Why they chose you, in their words, with the patterns across everyone.",
    audience: "customers",
    outputs: ["sheet"],
  },
  {
    id: "checkin",
    label: "Regular check-in",
    card: "run a weekly standup",
    sentence: "Run a regular check-in with {who}",
    report: "Who's on track, what's blocked, and what needs you. Same shape every round, so weeks compare.",
    audience: "team",
    outputs: ["sheet"],
  },
  {
    id: "team",
    label: "Ask my team",
    card: "what's slowing us down",
    sentence: "Ask {who}",
    report: "What the team said, grouped, with what to fix first.",
    audience: "team",
    outputs: ["sheet"],
    more: true,
  },
  {
    id: "references",
    label: "Check references",
    card: "for my next VP Sales",
    sentence: "Check references",
    report: "Where the references agree, where they differ, and any flags.",
    audience: "group",
    outputs: ["sheet"],
    more: true,
  },
  {
    id: "other",
    label: "Something else",
    card: "describe it in your own words",
    sentence: "",
    report: "A report on what they said.",
    audience: "group",
    outputs: ["sheet"],
    more: true,
  },
];

export function shapeById(id: ShapeId): Shape {
  return SHAPES.find((s) => s.id === id) ?? SHAPES[SHAPES.length - 1];
}

/** `group` is the unselected default ("the group"); the rest are the chips, in this order. */
export const AUDIENCES: { id: AudienceId; label: string; phrase: string }[] = [
  { id: "group", label: "The group", phrase: "the group" },
  { id: "network", label: "My network", phrase: "my network" },
  { id: "customers", label: "My customers", phrase: "my customers" },
  { id: "team", label: "My team", phrase: "my team" },
  { id: "strangers", label: "People I don't know yet", phrase: "people I don't know yet" },
  { id: "community", label: "My community", phrase: "my community" },
  { id: "friends", label: "Friends and family", phrase: "my friends and family" },
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

/** Whether the shape's sentence names its audience (and so shows the "Who are they?" chips). */
export function hasAudience(shape: Shape): boolean {
  return shape.sentence.includes("{who}");
}

/** The sentence with the audience dropped in, split around the audience so it can be styled: [before, who, after]. `who` is empty when the shape fixes its audience. */
export function sentenceParts(shape: Shape, audience: AudienceId): [string, string, string] {
  if (!hasAudience(shape)) return [shape.sentence, "", ""];
  const [before = "", after = ""] = shape.sentence.split("{who}");
  return [before, audiencePhrase(audience), after];
}

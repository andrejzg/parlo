/**
 * What the agent should make from the answers, beyond the report it always
 * writes: the creator's multi-select on the second card screen of creation.
 * The picks live in `surveys.outputs` (JSON array, migration 0014), go into
 * the composed brief so the question generator writes asks that feed them
 * (a podcast wants voice stories, Instagram adds a photo ask, TikTok adds a
 * video ask), and into the agent's `/brief.md` so the digest knows what to
 * produce after each round. Producers for each output come later; the pick
 * is the intent (GROWTH.md, 2026-10-15, S18/S19).
 *
 * Ids and order MUST match `frontend/src/lib/outputs.ts`.
 */
export type OutputId = "sheet" | "instagram" | "linkedin" | "tiktok" | "drive" | "table" | "podcast" | "other";

interface OutputSpec {
  id: OutputId;
  /** The name on the card. */
  label: string;
  /** What the agent makes, for `/brief.md`. */
  makes: string;
  /** How the questions should change to feed it; empty when they shouldn't. */
  questions: string;
}

export const OUTPUTS: OutputSpec[] = [
  {
    id: "sheet",
    label: "Google Sheet",
    makes: "A Google Sheet with one row per person that fills as answers land.",
    questions: "Keep the answers comparable across people so they tabulate cleanly.",
  },
  {
    id: "instagram",
    label: "Instagram carousel",
    makes: "An Instagram carousel and caption built from the group's answers and photos.",
    questions: "Make one question a photo question that asks for a picture that shows what they mean.",
  },
  {
    id: "linkedin",
    label: "LinkedIn post",
    makes: "A LinkedIn post in the creator's voice built on the group's best lines.",
    questions: "Make sure one question invites a crisp, quotable line from each person.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    makes: "A short vertical video cut from the group's clips.",
    questions: "Make one question a video question that asks for a short, visual moment worth watching.",
  },
  {
    id: "drive",
    label: "Google Drive folder",
    makes: "A Google Drive folder with the raw answers as files: audio, photos, video and transcripts, one folder per person.",
    questions: "",
  },
  {
    id: "table",
    label: "Agent-ready URL",
    makes: "A secure URL to a queryable table of the answers that the creator's other AI tools can read.",
    questions: "Keep the answers comparable across people so they tabulate cleanly.",
  },
  {
    id: "podcast",
    label: "Podcast",
    makes: "A short episode cut from the group's voice notes, with narration between them.",
    questions:
      "Keep every question a voice question and ask for told moments with a beginning and an end, so each answer can stand on its own as a clip.",
  },
  {
    id: "other",
    label: "Somewhere else",
    makes: "An export to a destination the creator connects on the dashboard (Notion, Slack, their own tool).",
    questions: "",
  },
];

export const OUTPUT_IDS = OUTPUTS.map((o) => o.id);

export function isOutputId(v: unknown): v is OutputId {
  return typeof v === "string" && (OUTPUT_IDS as string[]).includes(v);
}

/** Validate a request body's `outputs`: unknown ids dropped, duplicates collapsed, canonical order. */
export function sanitizeOutputs(v: unknown): OutputId[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.filter(isOutputId));
  return OUTPUT_IDS.filter((id) => set.has(id));
}

/** Parse the `surveys.outputs` column. */
export function parseOutputs(json: string | null | undefined): OutputId[] {
  if (!json) return [];
  try {
    return sanitizeOutputs(JSON.parse(json));
  } catch {
    return [];
  }
}

/** The lines `composeBrief()` adds so the question generator writes asks that feed the outputs. */
export function outputsBriefLines(ids: OutputId[]): string[] {
  if (ids.length === 0) return [];
  const specs = ids.map((id) => OUTPUTS.find((o) => o.id === id)!);
  const notes = Array.from(new Set(specs.map((s) => s.questions).filter(Boolean)));
  return [
    `Also make, after every round: ${specs.map((s) => s.label).join(", ")}.`,
    ...(notes.length ? [`So that these can be made: ${notes.join(" ")}`] : []),
  ];
}

/** The "Also make" section of the agent's `/brief.md`. */
export function outputsAgentSection(ids: OutputId[]): string {
  if (ids.length === 0) return "(nothing beyond the report)";
  return ids.map((id) => OUTPUTS.find((o) => o.id === id)!).map((s) => `- ${s.label}: ${s.makes}`).join("\n");
}

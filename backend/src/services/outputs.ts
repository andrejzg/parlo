/**
 * What the agent should make from the answers, beyond the report it always
 * writes: the creator's multi-select on the second card screen of creation.
 * The deck is content types, not channels (GROWTH.md, 2026-10-25): a
 * carousel goes to Instagram, LinkedIn and TikTok alike, so the pick says
 * what to make and the Exports card says where it goes. The picks live in
 * `surveys.outputs` (JSON array, migration 0014), go into the composed brief
 * so the question generator writes asks that feed them (an episode wants
 * voice stories, a carousel may add a photo ask, clips may add a video ask),
 * and into the agent's `/brief.md` so the digest knows what to produce after
 * each round. Producers for each output come later; the pick is the intent
 * (GROWTH.md, 2026-10-15, S18/S19).
 *
 * Ids and order MUST match `frontend/src/lib/outputs.ts`. The channel ids
 * the deck used from 2026-10-15 to 2026-10-25 are still accepted and mapped
 * to their content type (`LEGACY_OUTPUTS`), so old parlos and cached
 * frontends keep working.
 */
export type OutputId = "sheet" | "clips" | "post" | "thread" | "carousel" | "episode";

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
    label: "Google Sheet & Drive",
    makes:
      "A Google Sheet with one row per answer that fills as answers land, and a Google Drive folder with the raw files: audio, photos, video and transcripts, one folder per person.",
    questions: "Keep the answers comparable across people so they tabulate cleanly.",
  },
  {
    id: "clips",
    label: "Clips",
    makes:
      "Short audio and video clips for Reels, TikTok and Shorts: each voice answer as a captioned audiogram over a still, and any video answers cut to vertical.",
    questions:
      "Ask for told moments with a beginning and an end, so each answer can stand on its own as a clip. You may make one question a video question that asks for a short, visual moment worth watching.",
  },
  {
    id: "post",
    label: "Post",
    makes: "A post in the creator's voice built on the group's best lines, ready to paste on LinkedIn, X or Threads.",
    questions: "Make sure one question invites a crisp, quotable line from each person.",
  },
  {
    id: "thread",
    label: "Thread",
    makes: "A thread with one take per person, in order, each a short post of its own, for X or Threads.",
    questions: "Make sure one question invites a crisp, quotable line from each person.",
  },
  {
    id: "carousel",
    label: "Carousel",
    makes:
      "A swipeable carousel of quote cards, one per person, with a caption, for Instagram, LinkedIn or TikTok photo mode.",
    questions:
      "Make sure one question invites a crisp, quotable line from each person. You may make one question a photo question that asks for a picture that shows what they mean.",
  },
  {
    id: "episode",
    label: "Episode",
    makes: "A short podcast episode cut from the group's voice notes, with narration between them.",
    questions:
      "Keep every question a voice question and ask for told moments with a beginning and an end, so each answer can stand on its own as a clip.",
  },
];

/** Channel ids from the 2026-10-15 deck → the content type they meant. Unmapped (`drive`, `table`, `other`) fold into the sheet or nothing. */
export const LEGACY_OUTPUTS: Record<string, OutputId | null> = {
  instagram: "carousel",
  linkedin: "post",
  tiktok: "clips",
  podcast: "episode",
  drive: "sheet",
  table: "sheet",
  other: null,
};

export const OUTPUT_IDS = OUTPUTS.map((o) => o.id);

export function isOutputId(v: unknown): v is OutputId {
  return typeof v === "string" && (OUTPUT_IDS as string[]).includes(v);
}

/** A current id as is, a legacy id as its content type, anything else null. */
export function resolveOutputId(v: unknown): OutputId | null {
  if (isOutputId(v)) return v;
  if (typeof v === "string" && v in LEGACY_OUTPUTS) return LEGACY_OUTPUTS[v];
  return null;
}

/** Validate a request body's `outputs`: legacy ids mapped, unknown ids dropped, duplicates collapsed, canonical order. */
export function sanitizeOutputs(v: unknown): OutputId[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.map(resolveOutputId).filter((id): id is OutputId => id !== null));
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

/**
 * What the agent should make from the answers, beyond the report it always
 * writes. The second card screen of creation ("What should the agent make?"),
 * multi-select: a Google Sheet (on by default), Instagram, LinkedIn, TikTok,
 * Google Drive, an agent-ready URL, a podcast, somewhere else. The picks are
 * stored on the survey and shape the questions the model writes (a podcast
 * wants voice stories, Instagram adds a photo ask, TikTok adds a video ask);
 * the artefacts themselves arrive with the report after each round. See
 * GROWTH.md, 2026-10-15.
 *
 * Ids and order MUST match `backend/src/services/outputs.ts`.
 */
export type OutputId = "sheet" | "instagram" | "linkedin" | "tiktok" | "drive" | "table" | "podcast" | "other";

export interface Output {
  id: OutputId;
  /** The name on the card. */
  label: string;
  /** The one line under it. */
  example: string;
}

export const OUTPUTS: Output[] = [
  { id: "sheet", label: "Google Sheet", example: "fills as answers land" },
  { id: "instagram", label: "Instagram", example: "carousel, adds a photo ask" },
  { id: "linkedin", label: "LinkedIn", example: "your voice, their best lines" },
  { id: "tiktok", label: "TikTok", example: "a vertical cut, adds a video ask" },
  { id: "drive", label: "Google Drive", example: "the raw answers, as files" },
  { id: "table", label: "Agent-ready URL", example: "your other AI tools can ask it" },
  { id: "podcast", label: "Podcast", example: "an episode from their voices" },
  { id: "other", label: "Somewhere else", example: "Notion, Slack, your own tool" },
];

/** On before the creator touches the screen; a tap turns it off like any other card. */
export const DEFAULT_OUTPUTS: OutputId[] = ["sheet"];

export const OUTPUT_IDS = OUTPUTS.map((o) => o.id);

export function isOutputId(v: unknown): v is OutputId {
  return typeof v === "string" && (OUTPUT_IDS as string[]).includes(v);
}

/** Keep the canonical order whatever order they were tapped in. */
export function sortOutputs(ids: Iterable<OutputId>): OutputId[] {
  const set = new Set(ids);
  return OUTPUT_IDS.filter((id) => set.has(id));
}

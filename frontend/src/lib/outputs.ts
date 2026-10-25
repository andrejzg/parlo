/**
 * What the agent should make from the answers, beyond the report it always
 * writes. The second card screen of creation ("What should it make?"),
 * multi-select: content types, not channels (GROWTH.md, 2026-10-25), because
 * the type is what shapes the asks and the channel is only where the file
 * ends up. Google Sheet & Drive is on by default. The picks are stored on
 * the survey and shape the questions the model writes (an episode wants voice
 * stories, a carousel may add a photo ask, clips may add a video ask); the
 * artefacts themselves arrive with the report after each round.
 *
 * Ids and order MUST match `backend/src/services/outputs.ts`. The backend
 * also still accepts the channel ids this deck used until 2026-10-25.
 */
export type OutputId = "sheet" | "clips" | "post" | "thread" | "carousel" | "episode";

export interface Output {
  id: OutputId;
  /** The name on the card. */
  label: string;
  /** The one line under it. */
  example: string;
}

export const OUTPUTS: Output[] = [
  { id: "sheet", label: "Google Sheet & Drive", example: "answers and raw files" },
  { id: "clips", label: "Clips", example: "short audio & video clips" },
  { id: "post", label: "Post", example: "their best lines, in your voice" },
  { id: "thread", label: "Thread", example: "one take per person, in order" },
  { id: "carousel", label: "Carousel", example: "quote cards to swipe through" },
  { id: "episode", label: "Episode", example: "their voices, edited into one" },
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

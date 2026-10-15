-- What the agent should make beyond the report (2026-10-15): the creator's
-- multi-select on the second card screen of creation, as a JSON array of
-- ids from `services/outputs.ts` (transcripts, reel, podcast, linkedin,
-- instagram, sheet, table, other). NULL or '[]' = just the report.
ALTER TABLE surveys ADD COLUMN outputs TEXT;

-- Output-first creation (2026-10-14): the creator picks the shape of what
-- comes back (decide / rank / temperature / ideas / stories / feedback /
-- headcount / other) and who the group is. The composed brief still lives in
-- `brief`; these two columns let the agent commit to the report format and
-- let us measure which shapes get answered.
ALTER TABLE surveys ADD COLUMN output_shape TEXT;
ALTER TABLE surveys ADD COLUMN audience_kind TEXT;

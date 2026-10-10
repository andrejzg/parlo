-- Agent brief flow: the creator describes their research agent in one go
-- (transcript stored in `brief`), then answers Cerebras-generated clarifying
-- questions (stored as a JSON array of {question, answer} in
-- `brief_clarifications`). Both are written at generate time so the "proper
-- agent" work can build on the full creator intent later.
ALTER TABLE surveys ADD COLUMN brief TEXT;
ALTER TABLE surveys ADD COLUMN brief_clarifications TEXT;

-- Creator voice intro: after reviewing their questions the creator records a
-- short hello that participants hear on the welcome screen. Audio lives in R2
-- at `surveys/{id}/intro.webm`; the transcript is filled in by Whisper in the
-- background so the intro is searchable and has a text fallback.
ALTER TABLE surveys ADD COLUMN intro_r2_key TEXT;
ALTER TABLE surveys ADD COLUMN intro_duration_ms INTEGER;
ALTER TABLE surveys ADD COLUMN intro_transcript TEXT;

-- APPLIED TO PRODUCTION on 2026-10-24, then the feature was parked (branch
-- `feature/voice-first-opening`, GROWTH.md 2026-10-25). The file stays so
-- `d1_migrations` and this folder agree (pitfall 16) and the next migration
-- is numbered 0016. Nothing on this branch reads these columns; they are
-- nullable and harmless. Drop them in a later migration if the idea dies.
--
-- The creator's cloned voice (Inworld instant voice cloning) on the user, and
-- the kind of opener (voice | text | video) on the parlo.
ALTER TABLE users ADD COLUMN voice_id TEXT;
ALTER TABLE users ADD COLUMN voice_sample_r2_key TEXT;
ALTER TABLE users ADD COLUMN voice_cloned_at TEXT;
ALTER TABLE surveys ADD COLUMN intro_kind TEXT;

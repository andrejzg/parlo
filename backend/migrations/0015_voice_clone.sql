-- The creator's cloned voice (Inworld instant voice cloning). The flow now
-- opens with the creator reading a fixed passage; the recording is kept in R2
-- at `surveys/{id}/voice-sample.wav` and the Inworld voice id lands on the
-- creator's `users` row so every parlo they make can speak in their voice.
ALTER TABLE users ADD COLUMN voice_id TEXT;
ALTER TABLE users ADD COLUMN voice_sample_r2_key TEXT;
ALTER TABLE users ADD COLUMN voice_cloned_at TEXT;

-- The opener (what participants hear first) can now be a recording, a typed
-- line synthesised in the cloned voice, or a video. NULL = voice (legacy rows).
ALTER TABLE surveys ADD COLUMN intro_kind TEXT;

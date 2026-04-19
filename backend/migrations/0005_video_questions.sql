-- Video question type support
-- Adds an optional `video_r2_key` to response_answers for video answers.
-- Video answers store an empty string in audio_r2_key (NOT NULL constraint)
-- and the actual key in video_r2_key. The transcription service still picks
-- them up because Whisper accepts the raw video file bytes (it just reads the
-- audio track and ignores the video frames).

ALTER TABLE response_answers ADD COLUMN video_r2_key TEXT;

-- Photo question type support
-- Adds an optional `question_type` to surveys (default 'voice', can be 'photo')
-- Adds an `image_r2_key` to response_answers for photo answers
-- Photo answers store an empty string in audio_r2_key (NOT NULL constraint)
-- and the actual key in image_r2_key. Code paths check image_r2_key first.

ALTER TABLE survey_questions ADD COLUMN question_type TEXT DEFAULT 'voice';
ALTER TABLE response_answers ADD COLUMN image_r2_key TEXT;

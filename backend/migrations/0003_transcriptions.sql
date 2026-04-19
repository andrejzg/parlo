ALTER TABLE response_answers ADD COLUMN transcription TEXT;
ALTER TABLE response_answers ADD COLUMN transcription_status TEXT DEFAULT 'pending';

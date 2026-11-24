-- Probing, pay for answers, and testimonials (2026-11-24, GROWTH.md
-- "Pay for answers, not attempts").

-- How well an answer answers its question, judged from the transcript once
-- it exists: answered | partial | unanswered. NULL = not judged (a photo, a
-- group parlo, or the judge was down). `verdict_note` says what is missing
-- in a few words, for the researcher.
ALTER TABLE response_answers ADD COLUMN verdict TEXT;
ALTER TABLE response_answers ADD COLUMN verdict_score REAL;
ALTER TABLE response_answers ADD COLUMN verdict_note TEXT;
-- JSON array of the follow-ups the agent asked inside the sitting before
-- letting go, in order: ["What was the number that made you look elsewhere?"]
ALTER TABLE response_answers ADD COLUMN probes TEXT;
-- Consent for this one answer when it differs from the response's: an answer
-- to a testimonial ask is 'voice' by the act of recording it under the notice.
ALTER TABLE response_answers ADD COLUMN publish_consent TEXT;

-- 'testimonial' for a round that asks named people for a line meant to be
-- used in public, under a notice shown on the ask, for a bonus (the round's
-- reward). NULL = an ordinary round.
ALTER TABLE rounds ADD COLUMN purpose TEXT;

-- Why a held reward is held, in words (the question that went unanswered).
ALTER TABLE rewards ADD COLUMN hold_note TEXT;

-- A participant said no to one ask (a testimonial they would rather not
-- give). It stops being pending for them and nobody is asked twice.
CREATE TABLE IF NOT EXISTS ask_declines (
  question_id TEXT NOT NULL REFERENCES survey_questions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  declined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (question_id, user_id)
);

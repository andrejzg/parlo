-- Creation analytics: everything we need to judge whether TypeSafe Jev
-- (brief checklist) and Cerebras (follow-ups, question generation) are
-- calibrated, and to see what creators change on the review screen.
--
-- surveys.generated_questions  JSON of the questions exactly as the model wrote
--                              them (last generation), so the review diff is
--                              always model-output vs. what the creator kept.
-- surveys.brief_eval           JSON of the last /brief/evaluate result.
-- surveys.review_diff          JSON ReviewDiff computed when questions are confirmed.
-- surveys.is_test              1 when created with the X-Parlo-Test header
--                              (team / Playwright traffic), so stats can skip it.
ALTER TABLE surveys ADD COLUMN generated_questions TEXT;
ALTER TABLE surveys ADD COLUMN brief_eval TEXT;
ALTER TABLE surveys ADD COLUMN review_diff TEXT;
ALTER TABLE surveys ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

-- One row per thing that happened while creating a survey, from either the
-- server (generation, judging, confirm diff) or the client (brief submitted,
-- answers, checkpoint choices, review edits). Read by the admin Creations tab.
CREATE TABLE creation_events (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  kind TEXT NOT NULL,
  idx INTEGER,
  payload TEXT,
  source TEXT NOT NULL DEFAULT 'server',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_creation_events_survey ON creation_events(survey_id, created_at);
CREATE INDEX idx_creation_events_kind ON creation_events(kind, created_at);

-- Human verdicts from the admin tab: was this tick / follow-up / question right?
-- One verdict per target; saving again replaces it.
CREATE TABLE creation_labels (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  target_kind TEXT NOT NULL,
  target_key TEXT NOT NULL,
  verdict TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_creation_labels_target ON creation_labels(survey_id, target_kind, target_key);

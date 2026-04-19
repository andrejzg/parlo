-- Read tracking for the listening player
CREATE TABLE IF NOT EXISTS creator_survey_cursors (
  creator_id TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (creator_id, survey_id)
);

CREATE TABLE IF NOT EXISTS creator_read_responses (
  creator_id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (creator_id, response_id)
);

CREATE INDEX IF NOT EXISTS idx_crr_creator ON creator_read_responses(creator_id);
CREATE INDEX IF NOT EXISTS idx_responses_survey_status_submitted ON responses(survey_id, status, submitted_at);

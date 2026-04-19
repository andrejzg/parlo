CREATE TABLE creators (
  id TEXT PRIMARY KEY,
  phone TEXT,
  wa_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_creators_phone ON creators(phone) WHERE phone IS NOT NULL;

CREATE TABLE surveys (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  dashboard_code TEXT NOT NULL UNIQUE,
  creator_id TEXT NOT NULL REFERENCES creators(id),
  title TEXT,
  visibility TEXT DEFAULT 'open',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE survey_audio (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  question_key TEXT NOT NULL,
  audio_r2_key TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE survey_questions (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  sort_order INTEGER NOT NULL,
  text TEXT NOT NULL,
  hint TEXT
);

CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  status TEXT DEFAULT 'in_progress',
  submitted_at TEXT
);

CREATE TABLE response_answers (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES responses(id),
  question_id TEXT NOT NULL REFERENCES survey_questions(id),
  audio_r2_key TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);

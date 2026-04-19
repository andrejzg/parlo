-- Canonical participant identity across all Parlos
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  linkedin_sub TEXT,
  linkedin_name TEXT,
  linkedin_photo_url TEXT,
  linkedin_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Junction: which participants responded to which surveys
CREATE TABLE IF NOT EXISTS survey_participants (
  survey_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  response_id TEXT,
  responded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (survey_id, participant_id)
);

-- Notification feed for both creators and participants
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_phone TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  survey_id TEXT,
  survey_title TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_phone ON notifications(user_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_survey_participants_survey ON survey_participants(survey_id);
CREATE INDEX IF NOT EXISTS idx_participants_phone ON participants(phone);

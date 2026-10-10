-- Agent-run groups (2026-10-10).
--
-- 1. One identity table. `creators` becomes `users`; everyone who has ever
--    verified a phone (creator or participant) is a row here. The old
--    `participants` table is backfilled into it and left in place, unused.
-- 2. Membership with roles. `group_members` holds owner / admin / member per
--    parlo, plus a per-member access token that personal links carry.
--    Answering a parlo makes you a member ("answering is joining").
-- 3. Visibility changes meaning. `surveys.visibility = 'open'` now means an
--    OPEN GROUP: members hear each other's answers, with names. The default
--    is private (only owner + admins + the agent hear raw answers; everyone
--    gets the agent's report). Every existing parlo is locked to private,
--    and every submitted response records the policy it was recorded under.
-- 4. Rounds. A round is the agent's turn. Round 1 is the original question
--    set; later rounds hold asks targeted at everyone or at one member.

-- ── 1. Identity ─────────────────────────────────────────────────────────
ALTER TABLE creators RENAME TO users;
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;

INSERT OR IGNORE INTO users (id, phone, first_name, last_name, linkedin_sub, linkedin_name, linkedin_email, linkedin_photo_url, created_at)
  SELECT p.id, p.phone, p.first_name, p.last_name, p.linkedin_sub, p.linkedin_name, p.linkedin_email, p.linkedin_photo_url, p.created_at
  FROM participants p
  WHERE p.phone NOT IN (SELECT phone FROM users WHERE phone IS NOT NULL);

UPDATE users
  SET first_name = COALESCE(first_name, (SELECT p.first_name FROM participants p WHERE p.phone = users.phone)),
      last_name  = COALESCE(last_name,  (SELECT p.last_name  FROM participants p WHERE p.phone = users.phone))
  WHERE phone IS NOT NULL;

-- ── 2. Membership ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  access_token TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  invited_by TEXT,
  removed_at TEXT,
  PRIMARY KEY (survey_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_token ON group_members(access_token);

-- Every survey's creator is its owner.
INSERT OR IGNORE INTO group_members (survey_id, user_id, role, access_token, joined_at)
  SELECT id, creator_id, 'owner', lower(hex(randomblob(12))), created_at FROM surveys;

-- Everyone who responded is a member.
INSERT OR IGNORE INTO group_members (survey_id, user_id, role, access_token, joined_at)
  SELECT sp.survey_id, u.id, 'member', lower(hex(randomblob(12))), sp.responded_at
  FROM survey_participants sp
  JOIN participants p ON p.id = sp.participant_id
  JOIN users u ON u.phone = p.phone;

-- ── 3. Visibility ───────────────────────────────────────────────────────
UPDATE surveys SET visibility = 'private';

ALTER TABLE responses ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE responses ADD COLUMN visibility_at_submit TEXT;
UPDATE responses SET visibility_at_submit = 'private' WHERE status != 'in_progress';

-- Link old responses to users by phone so members' histories carry over.
UPDATE responses
  SET user_id = (SELECT u.id FROM users u WHERE u.phone = responses.phone)
  WHERE user_id IS NULL AND phone IS NOT NULL;

-- ── 4. Rounds ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  number INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'poll' CHECK (kind IN ('poll', 'probe')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'sent', 'rejected', 'closed')),
  rationale TEXT,
  proposed_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  UNIQUE (survey_id, number)
);
CREATE INDEX IF NOT EXISTS idx_rounds_survey ON rounds(survey_id, status);

ALTER TABLE survey_questions ADD COLUMN round_id TEXT REFERENCES rounds(id);
ALTER TABLE survey_questions ADD COLUMN target_user_id TEXT REFERENCES users(id);
ALTER TABLE responses ADD COLUMN round_id TEXT REFERENCES rounds(id);

-- Round 1 = the original question set, already sent.
INSERT OR IGNORE INTO rounds (id, survey_id, number, kind, status, proposed_by, created_at, sent_at)
  SELECT lower(hex(randomblob(10))), id, 1, 'poll', 'sent', 'creator', created_at, created_at FROM surveys;

UPDATE survey_questions
  SET round_id = (SELECT r.id FROM rounds r WHERE r.survey_id = survey_questions.survey_id AND r.number = 1)
  WHERE round_id IS NULL;

UPDATE responses
  SET round_id = (SELECT r.id FROM rounds r WHERE r.survey_id = responses.survey_id AND r.number = 1)
  WHERE round_id IS NULL;

-- Agent-written artefacts mirrored from the group agent for cross-group reads.
ALTER TABLE surveys ADD COLUMN report_md TEXT;
ALTER TABLE surveys ADD COLUMN report_updated_at TEXT;

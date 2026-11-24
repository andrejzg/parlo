-- The research studio (2026-11-24, GROWTH.md "Parlo as a research studio").
--
-- 1. A fourth seat, the client: the company that commissioned the study.
--    Hears raw answers, shapes the brief and steers; never approves a round,
--    never sees a phone number, never manages members.
-- 2. Sponsored studies: who hears the answers besides the research team, and
--    a stamp on every response saying it was given knowing that.
-- 3. Invite links for co-researchers and the client's team.
-- 4. The living brief: the questions the study must answer, their status as
--    the agent reads the answers, and a log of every change and steer.
-- 5. Rewards: a price per touch on a round, a budget on the study, and a
--    ledger with one row per member per round.

-- ── 1. The client seat ──────────────────────────────────────────────────
-- `group_members.role` carries a CHECK, which SQLite cannot alter, so the
-- table is rebuilt. Nothing references it by foreign key.
CREATE TABLE group_members_new (
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'client', 'member')),
  access_token TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  invited_by TEXT,
  removed_at TEXT,
  -- Which group of participants this member belongs to ("Customer",
  -- "Competitor user"); the report cuts by it and a round can be aimed at it.
  segment TEXT,
  -- One line a researcher knows about them ("VP Eng, 200-person fintech").
  descriptor TEXT,
  PRIMARY KEY (survey_id, user_id)
);
INSERT INTO group_members_new (survey_id, user_id, role, access_token, joined_at, invited_by, removed_at)
  SELECT survey_id, user_id, role, access_token, joined_at, invited_by, removed_at FROM group_members;
DROP TABLE group_members;
ALTER TABLE group_members_new RENAME TO group_members;
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_token ON group_members(access_token);

-- Imported participants may come with an email and no phone.
ALTER TABLE users ADD COLUMN email TEXT;

-- ── 2. Sponsored studies ────────────────────────────────────────────────
-- Who, besides the research team, hears the answers. Shown on the consent
-- screen as written ("Acme", or "the company that commissioned this
-- research" for a blind study). NULL = not a sponsored study.
ALTER TABLE surveys ADD COLUMN sponsor_name TEXT;
-- 1 when the response was submitted under that consent line. The client
-- only ever hears responses stamped 1, like `visibility_at_submit`.
ALTER TABLE responses ADD COLUMN sponsor_consent INTEGER NOT NULL DEFAULT 0;

-- ── 3. Invite links ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'client')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invites_survey ON invites(survey_id);

-- ── 4. The living brief ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brief_items (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  text TEXT NOT NULL,
  -- suggested: the agent proposes adding it; open: nothing solid yet;
  -- emerging: a pattern with thin support; answered; dropped; dismissed.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('suggested', 'open', 'emerging', 'answered', 'dropped', 'dismissed')),
  origin TEXT NOT NULL DEFAULT 'researcher' CHECK (origin IN ('seed', 'researcher', 'client', 'agent')),
  created_by TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- The agent's current answer in a sentence, and for a suggestion, why.
  finding TEXT,
  why TEXT,
  voices INTEGER NOT NULL DEFAULT 0,
  -- JSON: [{"answerId": "...", "quote": "..."}]
  evidence TEXT,
  -- 'human' once a person set the status; the agent then leaves it alone.
  status_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brief_items_survey ON brief_items(survey_id, status);

CREATE TABLE IF NOT EXISTS brief_events (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  item_id TEXT,
  -- NULL = the agent.
  actor_id TEXT,
  actor_role TEXT NOT NULL,
  -- goal_edited | item_added | item_edited | item_dropped | item_reopened |
  -- item_answered | suggestion_made | suggestion_accepted |
  -- suggestion_dismissed | status_changed | steer | round_proposed | round_sent
  type TEXT NOT NULL,
  body TEXT,
  -- For a steer: the round that took it up (NULL = still open).
  -- For round_proposed / round_sent: that round.
  round_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brief_events_survey ON brief_events(survey_id, created_at);

-- JSON array of the brief item ids a round digs into.
ALTER TABLE rounds ADD COLUMN serves TEXT;

-- ── 5. Rewards ──────────────────────────────────────────────────────────
-- Default price per touch for new rounds, the study's cap, and the currency.
ALTER TABLE surveys ADD COLUMN reward_cents INTEGER;
ALTER TABLE surveys ADD COLUMN reward_budget_cents INTEGER;
ALTER TABLE surveys ADD COLUMN reward_currency TEXT NOT NULL DEFAULT 'USD';
-- What this round pays for an accepted answer; NULL or 0 = unpaid.
ALTER TABLE rounds ADD COLUMN reward_cents INTEGER;

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id),
  round_id TEXT NOT NULL REFERENCES rounds(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  response_id TEXT NOT NULL REFERENCES responses(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  -- pending: waiting for the transcripts; held: a researcher has to look
  -- (hold_reason); approved: owed, not yet at the provider; sent: the
  -- provider holds it and the member can claim; failed: the provider
  -- refused (error); void: cancelled by a researcher.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'approved', 'sent', 'failed', 'void')),
  hold_reason TEXT,
  provider TEXT,
  provider_order_id TEXT,
  provider_reward_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  -- The first time the member opened their redemption link.
  claimed_at TEXT,
  UNIQUE (round_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_rewards_survey ON rewards(survey_id, status);
CREATE INDEX IF NOT EXISTS idx_rewards_user ON rewards(user_id);

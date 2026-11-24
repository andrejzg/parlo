-- Study setup, publication consent, and who made a change (2026-11-24).

-- 'study' when a parlo is run as a research study: started from the study
-- setup screen or `POST /api/studies`, or the moment a client is invited or
-- participants are imported. NULL = a group parlo, as before. The
-- participant page drops its group furniture (member count, "Invite
-- someone") for a study.
ALTER TABLE surveys ADD COLUMN kind TEXT;

-- What a participant allowed beyond the study itself, asked on the consent
-- screen of a study and stamped on the response:
--   none  → nothing they said leaves the study (the default)
--   quote → their words may be quoted in public material, without their name
--   voice → their recorded voice may be used too
-- Anything meant for publication may only draw on quote / voice answers.
ALTER TABLE responses ADD COLUMN publish_consent TEXT NOT NULL DEFAULT 'none';

-- 'agent' when a change to the brief came through the MCP server, that is,
-- from an AI agent acting for someone on the team. NULL = a person, in the app.
ALTER TABLE brief_events ADD COLUMN via TEXT;

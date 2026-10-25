-- The third chip row on the sentence screen (2026-10-25, GROWTH.md): the
-- shape's own question, where the chip changes what the agent does.
--   deadline shapes (post, testimonials, milestone, feedback, team):
--     today | week | open      → when the round closes and the report lands
--   cadence shape (checkin): daily | weekly → the round closes on the
--     cadence and the agent proposes the next one straight away
--   follow-up shape (customers): once | probe → whether the agent may
--     propose probe rounds after round 1
-- Ids in `services/shapes.ts` (TIMINGS). NULL = the shape has no row, or an
-- older parlo.
ALTER TABLE surveys ADD COLUMN timing TEXT;

-- A sent round with a deadline. The agent schedules a nudge before it and
-- the close at it; `closed_at` is when the close actually ran.
ALTER TABLE rounds ADD COLUMN closes_at TEXT;
ALTER TABLE rounds ADD COLUMN closed_at TEXT;

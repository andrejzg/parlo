# Growth

The growth PM's log for Parlo. Claude wears this hat in every product discussion and keeps this file current: the north star, the principles, the experiment backlog ("shots at bat") and a dated decision log. Agents: read this before any product or UX discussion, append a dated entry after one, and move experiments through the statuses. Never rewrite history; add an entry.

## North star: the loop

Measure the loop, not the survey. Response count is a vanity metric once the agent is in the room.

```
report delivered → report opened → answered the next round → shared the report → started their own parlo
```

The three ratios that matter, in order:

1. reveal → answered the next round (retention)
2. reveal → shared back to the group (virality)
3. reveal → started their own parlo (the flywheel)

Funnel events today (frontend `trackEvent`, backend PostHog, project 653180): `group_report_viewed`, `participant_joined_group`, `consent_accepted {round, visibility}`, `participant_submitted`, `participant_share_survey_clicked`, `survey_creation_started`, `agent_digest_completed`, `agent_round_proposed`, `round_approved`.

Missing, to add with the episode work: `gate_shown`, `wait_shown`, `nudge_tapped`, `reveal_shown`, `report_shared`, `start_own_tapped {from}`. Instrument transitions, not screens.

## Principles

Applied from Nikita Bier's consumer-social playbook (full notes in Claude's memory, `reference_nikita_bier_playbook`).

- **One community first.** Pick a single WhatsApp-heavy group and be obnoxiously relevant to it. If it works in one it works in all; if it fails in three it fails everywhere.
- **The artefact that leaves the app beats the page inside it.** Parlo lives inside WhatsApp groups. The report image posted back to the group is the product's face; the web page is where you answer and get the reveal.
- **Gate and reveal are moments, not list items.** "Answer to unlock" is a curiosity cliff. The unlock is full-screen. Never flatten either into a feed.
- **Toilet test.** Each answer under 30 seconds. If it can't be done distracted, it won't become a habit.
- **Habit is exposure on other networks.** Nobody returns to a destination unprompted. Rounds, nudges and report posts are the re-entry points.
- **Shots at bat.** A reproducible test process beats any single idea. Every bet below ships with a hypothesis, one metric, a kill criterion and a review date.
- **Peer visibility drives completion.** In open groups, who hasn't answered is the retention engine. In private groups, the count is.

## Tooling for shots at bat

- PostHog project 653180: feature flags, experiments, funnels, cohorts. Nothing in the codebase reads a flag yet (checked 2026-10-11). Add a small `useFlag` helper in the frontend and a flag check in the Worker when the first experiment ships, and gate the variant on `surveyId` so a whole group sees one arm.
- Test bed: one community, still to pick. Candidates and the pick go in the decision log.
- Definition of "planned": hypothesis, primary metric, kill criterion, review date, and the events it needs are all written in the table before any code.
- Review cadence once live: weekly, in this file. Kept bets become defaults; killed bets stay in the table with the reason.

## Shots at bat

Statuses: `idea` → `planned` → `running` → `kept` / `killed`.

| # | Hypothesis | Primary metric | Status | Result / notes |
|---|---|---|---|---|
| S1 | Landing on the current round as an episode card (gate → wait → reveal) beats the dashboard/thread on reveal→share and reveal→start-own | reveal→share, reveal→start-own | idea | Needs `reveal_shown`, `report_shared`, `start_own_tapped` |
| S2 | A per-round report image posted back to WhatsApp ("Round 3 · what 11 of us said", locked for non-members) recruits new members | new members per report post | idea | Extend `GET /api/og/:code.png` per round |
| S3 | A "nudge the others" CTA on the wait card raises round completion | share of sent rounds reaching 80% answered | idea | Needs `nudge_tapped` |
| S4 | Rounds with a close date complete faster than open-ended ones | hours to 80% answered | idea | Needs `rounds.closes_at` and a countdown |
| S5 | "Start one for your group" at the reveal converts members to owners | start_own_tapped → survey_creation_started | idea | Only at peak delight; never on the gate |
| S6 | Agent-named rounds ("Round 2: the Saturday problem") get shared more than numbered ones | report_shared per round | idea | Title in the proposal JSON |
| S7 | Showing who hasn't answered raises completion in open groups | completion rate, open vs private | idea | Open groups only; privacy decision in `project_agent_group_pivot` |
| S8 | Output-first creation (pick the shape of what comes back, fill one blank, review) beats the free brief on start→share and time-to-share | survey_creation_started → create_share_reached, median seconds between them | running | Shipped as the default on 2026-10-14 (before/after, not an arm). Baseline 2026-10-12 (internal testers): 28 starts, 4 briefs submitted, no share reached that we could count. Kill criterion: after 30 starts, start→share still under 1 in 5. Review 2026-10-28. Events live: `create_shape_picked`, `create_blank_filled`, `create_share_reached`, `create_free_brief_opened` |
| S9 | Question-first creation (one line: "what do you want to ask them?", agent builds the rest) beats both the brief and the cards on start→share | same as S8 | idea | The minimal-intent arm of S8; cards move to review as "make it a decision / a ranking" |
| S10 | The "Something else" card's pick rate tells us whether the output-shape taxonomy covers real use cases | share of `create_shape_picked` with shape = other | running | Guardrail for S8, not a bet of its own: above ~25% the deck is wrong, rework before iterating cards |
| S11 | The logged-out parlo.me that *is* step one of creation (headline + the eight shape cards, a tap creates the parlo) beats the pitch-then-button landing on landing→blank filled | `$pageview /` → `create_blank_filled`, by device | idea | Landing arm. Needs `landing_shown {variant, context}` |
| S12 | A landing that leads with a real report card (sample parlo, two voice notes, the agent's report) converts cold visitors better than copy | landing→`survey_creation_started`, 5-second-test recall | idea | Reuses the per-shape report preview; the sample parlo is seeded, not fake |
| S13 | A participant-aware landing ("You just answered X's parlo · Start one for your group", shape pre-picked from the parlo they answered, their report as proof) beats the generic one on start-own | `start_own_tapped {from}` → `create_share_reached` | idea | Context from `?from=<code>` on "Powered by Parlo" and from `localStorage parlo-member:*`; S5 is the CTA, S13 is where it lands |
| S14 | Verified members who own no parlo see a hero on the home list ("Start one for your group" + cards) instead of a one-row list and a bare "+" | member-only homes → `survey_creation_started` | idea | Members never see the landing: the device record logs them in, so the home *is* their landing |
| S15 | "Drop me in a group chat": a landing whose only button opens the share sheet with a fresh link, round 1 written by the agent itself (what does this group keep going round in circles on), phone number asked after the first answers | `share_sheet_opened` → first answer within 24 h → number added | idea | The pick of the 2026-10-14 second pass. Needs a bootstrap round kind and a post-share claim. Kill if under 1 in 5 dropped links get any answer |
| S16 | "The agent answers the door": the landing is a voice note from the agent and a mic; the ramble picks the shape and lands on review | `landing_shown` → first utterance → `create_share_reached` | idea | S9 in a voice skin; the free-brief path already takes a ramble, add `shape` to the `/generate` response and a recorded hello |
| S17 | "Where decisions go to die": a scroll where a 47-message group chat collapses into one report card raises taps on whichever CTA sits under it | tap rate on the CTA, with vs without the scroll | idea | A frame for S15/S16, not a competitor; also the OG image for parlo.me itself |

## Decision log

Newest first. Each entry: context, what was discussed, where we lean, what it forces, what's still open.

### 2026-10-14 · What parlo.me should be when you are not logged in

**Context.** Andrej asked, as growth head and UX researcher, what the logged-out parlo.me should be, and whether the people who get there by word of mouth and the people who get there after answering a parlo should see the same thing. Mostly phones, some laptops. Ideas only, nothing to build yet.

**What is there today.** `CreateLanding`: a mic icon, "Group chats, run by an agent.", one subline, "Create a parlo", "Free to start · No account required". The same for everyone without a device record. Three things found reading the code: (1) a *verified* participant never sees it: the OTP they pass to submit hands out an API key, so parlo.me shows them the home list with the one parlo they answered and a bare "+", which is the flywheel's most important moment with no pitch on it; (2) the participant surfaces never point here: "Powered by Parlo" on the thank-you screen is plain text, not a link, and the reveal has "Invite someone" but no "Start one for your group" (S5); (3) there is no "Log in" on the landing, so an owner on a laptop or a new phone has to tap "Create a parlo" to reach the OTP. "No account required" is also not quite true: a phone number is required before the share link.

**Discussed.** Who arrives logged out, and the question each is asking: cold word-of-mouth ("what is this?"), warm participant whose record expired or who is on another device ("could I do this with my group, how hard is it?"), returning owner on a new device ("where are my parlos?"), and the laptop visitor (a creator at work, almost never a participant since WhatsApp links open on the phone). One page can serve all of them only because the segments are detectable: the device record, `parlo-member:*` tokens in localStorage, a `?from=<code>` on the referral link, screen width.

**Leaning.** Not a marketing site. The landing is the product's first screen with one line of pitch above it, and it changes by what we know about the visitor:
- Cold: one headline in the group's words, one real artefact (a sample report card, playable), then the eight shape cards. Tapping a card creates the parlo and goes to the blank. The cards are the explanation.
- Warm (`from` or a member token): "You answered <title>. Start one for your group." The report they unlocked as proof, the shape they experienced pre-selected, the cards underneath. Same page, different top.
- Verified member with no parlo of their own: the home list opens with that same hero above the rows (S14). Members never see the landing, so this is where S5 actually lands.
- Returning owner: a small "Already have parlos? Log in" link on the landing → phone → OTP → home. Not an experiment, a hole.
- Laptop: the same single column at phone width, centred, with the sample report beside it; typing the blank is fine, voice is not the point here. No QR hand-off until data says laptops matter.
Copy rule: headline is a shape verb and an outcome ("Settle it with the whole group in a minute"), never a category word. Social proof is the artefact, not a number we don't have.

**Research before code.** Five-second test of the current landing and of a paper version of the cards-as-landing (what does it do, who is it for, what would you tap). Watch five people arrive from a real parlo link to parlo.me and say out loud what they expect. Add `landing_shown {variant, context: cold|warm|member-home}` and `start_own_tapped {from}` so the arms are measurable at all; today there is no landing event, only `$pageview`.

**Forces.** "Powered by Parlo" becomes a link carrying `?from=<code>`; `GET /api/s/:code` already returns `output_shape`'s report line, enough for the warm hero; a seeded sample parlo for the cold hero; a Log in path from the landing; the shape cards extracted so `ShapeScreen` and the landing share them.

**Open.** Whether the cards on the landing confuse a cold visitor without the sentence context (the 5-second test answers this). Whether to lead with the artefact (S12) or the cards (S11) for cold traffic; they are not exclusive. How much the laptop case matters at all before the team/customers audiences are real.

**Not decided.** Nothing shipped.

**Second pass, same day.** Andrej asked for a braver take. The shop-window framing above (pitch, proof, product) keeps the visitor on parlo.me, where nothing happens; everything in this product happens in a WhatsApp group. Three concepts, sketched at https://claude.ai/artifact/F1DK3jfGUpikNCjfPXRKc2 (first pass at https://claude.ai/artifact/EBVS6b6wauHNQsS9Afqqs3): (1) **Drop me in a group chat**, the agent asks to be let in, one button opens the share sheet with a real anonymous draft link, round 1 is the agent's own bootstrap asks, the phone number is asked after the group has answered (S15); (2) **The agent answers the door**, a voice note and a mic, the ramble picks the shape (S16); (3) **Where decisions go to die**, a scroll in which a chaotic group chat collapses into one report card (S17). Leaning: ship 1 as the landing with 3 as the scroll beneath and 2 behind "I know what I want to ask". Paper-test the three first screens with five people before any code; the cheapest real test is S15's button plus the bootstrap round. Stop pursuing the sample report card from the first pass: it is proof for a reader, and the product wants someone to let the agent into a chat, not a reader.

### 2026-10-14 · Shipped output-first creation as the default

**Context.** Andrej read the 2026-10-12 proposal and asked for the current creation flow to be replaced with it outright, not run as an experiment arm.

**Decided.** Replace, measure before/after against the 2026-10-12 baseline. S8 and S10 move to `running`; S9 (question-first) stays an idea to test later against this new default. The free brief survives behind the "Something else" card, and the follow-up loop survives behind "Sharpen it" on review; nothing before the share link is mandatory except one card and one blank.

**Shipped.** Shape cards (`ShapeScreen`), the one-blank sentence with who/length chips (`TopicScreen`), review fidgeting (swap a question, "Shorter" / "More playful" rebuilds, "Sharpen it"), the "What comes back to the group" card, the composed brief on the backend (`services/shapes.ts`, `/generate`, `/questions/swap`), `output_shape` / `audience_kind` on `surveys`, the agent's report committed to the shape in `/brief.md`, the S8 events, and `create-flow.spec.ts` on three devices. The Voice / Type sheet is gone. Later the same day, on Andrej's note that the chips sent him back through the building screen: "Shorter" and "More playful" now rewrite the draft in place in about a second (`/questions/adjust`), the cards dim and the new wording fades in; the review screen never leaves. That is the fidget principle applied to the model call too: when a tap has to touch a model, keep the person on the same screen and show the change where they were looking.

**Open.** Hallway-test the deck with five people and their own real group now that it is live (watch where they hesitate on the cards and on the blank). Whether the who chips earn their place on the blank screen. Which community is the test bed. The nav "+" still goes straight in; a "Start one for your group" at the reveal (S5) would be the next entry point to wire.

### 2026-10-12 · Fidgetable creation: start from what comes back, not from a brief

**Context.** The creation flow is still the old product's: a blank canvas ("describe your research agent"), five checklist items that are the model's needs rather than the creator's mental model, then a mandatory clarify loop. PostHog, last 30 days, internal testers only: 28 `survey_creation_started` from 6 people, 4 `brief_submitted` from 3. The hardest cognitive work in the product sits first, before any value, and it demands a performance (speaking a coherent brief alone into a phone). The brief is the top of the viral loop: every parlo that gets created is a link into a WhatsApp group, so creation abandonment is lost distribution.

**Discussed.** Andrej's proposal: invert it, medium-sized tappable cards for what you want the output to be, then build up to intent. Growth and UX-research pass: agreed, with one sharpening. The cards must be *shapes of what comes back* (decide, rank, take the temperature, collect ideas, hear stories, get feedback on something, head count, something else), never use-case templates. Shapes are finite and any domain maps onto them; templates are the SurveyMonkey trap and stop scaling the day a use case doesn't match. The shape is also the artefact that gets posted back to the group, so picking it up front makes the report predictable (feeds S2). Alternatives on the table: question-first (one line, agent does the rest; the fewest screens before the link), remix an example parlo (strong once there is public UGC, template-ish before), start from the group (who → what; too little signal), agent-led chat with chips (the same thing in a slower skin; keep the agent's voice as the screen titles instead).

**Leaning.** Cards → one blank → review → share. Screen 1: "What do you want back?", eight shape cards, each a verb, a one-line example and a miniature of the report it produces. Screen 2: the sentence the card started, with one blank ("Help the group decide ___"), voice or type, plus "who" chips (friends & family / my team / customers / a community / people I don't know) that set tone and swap the examples, and a size toggle (quick / a few minutes). Then building → review, where the real fidgeting lives: tap a question to swap or rewrite it, "shorter" / "more playful" chips, reorder, flip a question to photo or video. The clarify loop becomes optional ("Sharpen it"). The current brief screen survives as the "Something else" escape hatch, the way "Type instead" does. Design rule: every tap changes something on screen within 100 ms with no model call (templated previews); the model runs once, at build. Target: under 60 s from "+" to a copied link.

**Forces.** Compose the brief string from picks + the blank so `/generate` and `/clarify` keep working unchanged; store the shape on the survey so the agent's report prompt commits to that format; one report preview per shape (doubles as the per-round report image design); the four events in S8; a feature flag keyed on the creator so S8/S9 can run as arms.

**Open.** Whether the "who" chips earn their place on screen 2 or belong in review. Whether the first screen should be the cards (S8) or the single question (S9); run both arms. Which five people to hallway-test the paper deck with before any code (one afternoon, their own real group, watch where they hesitate).

**Not decided.** Nothing shipped; the uncommitted text-mode polish on `BriefScreen` stays useful as the escape hatch.

### 2026-10-11 · What you see when you click into a parlo

**Context.** Rounds exist in D1 and the agent proposes them, but no screen is organised around them. The owner lands on a flat Responses feed with Members and Agent tabs; a member lands on the report card with a "Round N" pill and a CTA.

**Discussed.** First form: one parlo screen for everyone shaped like a group chat with the agent, each round a chapter, a round strip under the title, the agent's proposal as the last bubble with Send. Then the growth critique: that is a PM's information architecture. It's a destination competing with WhatsApp, and it turns the gate and the reveal into list items.

**Leaning.** A round is an episode. The landing is always the current round in its current state: the gate (count, faces, deadline, one mic button), the wait (you've answered, nudge the others), the reveal (the report as a designed card, then "Post this to the group" and "Start one for your group"). The chat thread survives as the history view and the owner console. The round visualisation that matters most is the report image non-members see in the WhatsApp group.

**Forces.** `closes_at` on `rounds`; the agent names rounds in the proposal JSON; per-round report snapshots (`/rounds/N-report.md`) alongside the living `/report.md`; a per-round OG image; the missing funnel events above.

**Open.** Do late joiners see earlier rounds? Leaning yes for the agent's asks and reports, own answers only from when they joined. Which community is the test bed.

**Not decided.** Nothing shipped. S1 is the test that settles thread vs episode; don't commit the frontend before it has a plan.

### 2026-10-10 · Measure the loop

North star agreed: report → answered the next round → started their own parlo. Response count is vanity. "Answer to unlock the report" is the mechanic that feeds it. Recorded in Claude's memory as `project_measure_the_loop`.

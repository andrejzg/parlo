# Parlo

Group chats, run by an agent. A creator describes what they want to learn (by voice or by typing), shares a link on WhatsApp, and everyone who answers by voice joins the group. A persistent agent (one Durable Object per parlo) gathers the answers, writes the report members get back, and proposes follow-up rounds for the owner to approve. See "Groups, rounds and the agent" below.

## Rules for Agents

1. **Read this file before making changes.** It documents API contracts, naming conventions, and known pitfalls.
2. **Update this file** whenever you add or change an API endpoint, rename a key, add a new service, or discover a new pitfall. Keep it in sync with the code.
3. **Verify API response shapes** by reading the actual backend route handler before writing frontend code that calls it. Do not guess field names.
4. **Use the exact deploy commands** listed below. Getting these wrong deploys to the wrong target.
5. **For UI work, follow `GUI.md`** (project root) and the Parlo1 theme references in `gui/`. Use the `graphical-ui` skill to build or edit screens with the current theme, `graphical-convert` to bring old UI onto it, and `graphical-audit` to find theme drift. The skills live in `.agents/skills/`; read them directly if your harness doesn't surface them.
6. **Wear the growth PM hat in product discussions and keep `GROWTH.md` current.** It holds the north-star loop, the principles, the experiment backlog ("shots at bat") and a dated decision log. Read it before any product or UX discussion, append a dated entry after one, and move experiments through `idea → planned → running → kept/killed`. Never rewrite history.

## Project Structure

```
parlo/
  frontend/          — React+Vite app on Cloudflare Pages (parlo.me)
  backend/           — Cloudflare Worker + Hono (api.parlo.me)
  fe_experiments/    — Original prototypes (reference only, not deployed)
  GROWTH.md          — Growth PM log: north star, principles, shots at bat, decision log
```

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite (SWC), Tailwind CSS, shadcn/ui, Framer Motion
- **Backend:** Cloudflare Workers, Hono router, TypeScript
- **Database:** Cloudflare D1 (SQLite)
- **Audio Storage:** Cloudflare R2 (presigned upload URLs with one-time tokens)
- **Group agent:** Cloudflare Agents SDK (`agents` package) — `GroupAgent` Durable Object in `backend/src/agent/GroupAgent.ts`, binding `GROUP_AGENT`, instance name = survey id. Its private SQLite holds the agent's file system (a `files` table). The planning loop runs on the Vercel AI SDK (`ai` v7, `generateText` + tools): Claude Opus 5.5 via `@ai-sdk/anthropic` when `ANTHROPIC_API_KEY` is set (provisioned 2026-10-11 as a Worker secret, a GitHub Actions secret and in `backend/.dev.vars`; it is a user-scoped key that **expires around 2026-11-10 and must be rotated** in all three places), else Cerebras `gpt-oss-120b` via `@ai-sdk/cerebras`, else Workers AI Llama 3.3 via `workers-ai-provider` (`backend/src/agent/model.ts`). Needs `nodejs_compat`, a SQLite DO migration tag and wrangler 4 (all in `backend/wrangler.toml` / `package.json`).
- **AI:** Cerebras `gpt-oss-120b` for question generation (secret `CEREBRAS_API_KEY`; falls back to Workers AI Llama 3.3 70B if the key is missing or the call fails) + Cloudflare Workers AI Whisper (STT — Cerebras has no speech-to-text)
- **TypeSafe (typed AI judgments):** secret `TYPESAFE_API_KEY` — set as a GitHub Actions secret (synced to the Worker on deploy), already on the `parlo-backend` Worker, and in the gitignored `backend/.dev.vars` for local work and agents (`wrangler dev` reads it automatically). Read it from `c.env.TYPESAFE_API_KEY` server-side only; never ship it to the frontend or commit it. Current key is a pre-launch dev key — rotate before going live. Use the `typesafe-ai` skill when building with it; docs at https://docs.typesafe.ai/llms.txt
- **WhatsApp:** Kapso.ai (@kapso/whatsapp-cloud-api)
- **Phone Auth:** Firebase Phone Auth (SMS OTP) + WhatsApp OTP fallback via Kapso. The backend never takes a phone number as identity: it needs a **proof** — the Firebase ID token (verified against Google's published keys in `backend/src/services/phoneProof.ts`; `FIREBASE_PROJECT_ID` in `wrangler.toml [vars]`) or the proof token `POST /api/otp/verify-whatsapp` mints. See "Phone proof" under API Contracts.
- **Photo capture:** native `<input type="file" capture="environment">` + `browser-image-compression` (client-side JPEG transcode at 1080px / ~1MB / 0.85 quality)
- **Video capture:** native `<input type="file" accept="video/*" capture="environment">` (60s + 25MB hard caps, vertical-only, no client compression — relies on phone's hardware H.264 encoder)
- **Analytics:** PostHog (US region, project 653180 under andrej@parlo.me) — frontend + backend events + LLM observability
- **Auth (admin):** Cloudflare Access (Google Workspace @parlo.me)
- **Auth (API):** API key (`pk_` prefix) per creator, stored in D1. Header: `X-Parlo-Api-Key` or `Authorization: Bearer pk_...`
- **Offline persistence:** IndexedDB (sessionStore.ts) — stores session state + audio blobs
- **Background uploads:** uploadQueue.ts — uploads blobs as recorded, retries on failure/offline
- **Audio merge:** audioMerge.ts — merges multi-segment recordings into single WAV for upload
- **Silence trimming:** audioTrim.ts — every recording is trimmed on the phone before it's stored/played/uploaded (see "Silence trimming" below)
- **E2E Testing:** Playwright (frontend/e2e/) — mock audio + API fixtures. Happy-path specs + cross-device visual audit (`device-audit.spec.ts`) covering iPhone SE, Pixel 7, iPhone 15 Pro Max.

## API Contracts

IMPORTANT: When building frontend features that call the backend, always verify the actual response shape by reading the backend route handler. Do NOT guess field names.

### POST /api/surveys
Creates a parlo: a `users` row for the owner (anonymous until a phone is claimed), the survey with `visibility = 'private'`, an `owner` row in `group_members`, and round 1 in `rounds`. Accepts empty body or `{creatorPhone?, creatorName?, title?}`. **With an API key (since 2026-10-25) the authenticated user is the owner outright** (the MCP server, an owner's personal agent, a verified device): no claim step, the parlo is in their home list at once, and the returned `apiKey` is theirs. Without a key the owner is a fresh anonymous user as before.
Returns:
```json
{
  "id": "string",
  "code": "string (6-char)",
  "dashboardCode": "string (12-char)",
  "apiKey": "string (pk_ + 32 chars, only generated once per creator)",
  "uploadUrls": {
    "brief": "string (presigned URL — the creator's single brief recording)",
    "audience": "string (presigned URL — legacy two-question flow)",
    "gather": "string (presigned URL — legacy two-question flow)"
  }
}
```

### POST /api/surveys/:id/transcribe
Whisper for a creator recording. Body: raw audio bytes (any `Content-Type`) or multipart with an `audio` field. Max 12 MB. Rate limited 600/hr per IP (the live fallback polls every ~4.5 s).
Returns: `{text: "string"}`

### POST /api/surveys/:id/brief/evaluate
Which brief-checklist items does a transcript cover? Called (debounced) while the creator talks. TypeSafe Jev answers five Noul questions in one ~300 ms call; falls back to Cerebras, then Workers AI Llama, returning booleans as 1/0 probabilities. Body: `{transcript: string}` (max 20k chars; under 12 chars returns all-false without calling a model).
Returns:
```json
{
  "items": [{"id": "audience|goal|purpose|tone|length", "satisfied": true, "probability": 0.97}],
  "complete": false,
  "provider": "typesafe | cerebras | cloudflare-workers-ai | none",
  "model": "jev-1.13.0 | null"
}
```
`satisfied` = probability ≥ 0.7 (`BRIEF_SATISFIED_THRESHOLD` in `backend/src/services/brief.ts`). The frontend applies hysteresis on top (tick ≥ 0.7, untick < 0.45).

### POST /api/surveys/:id/clarify
Next clarifying question from Cerebras (Workers AI Llama fallback). Stateless — the frontend sends everything so far each time. Body: `{brief: string, history: [{question, answer}]}` (history capped at 40 entries, 4k chars each).
Returns: `{question: "string", hint: "string | null", index: number}` — `index` is 1-based (`history.length + 1`).

### POST /api/surveys/:id/generate
Triggers AI pipeline. Three modes:
- **Output-first flow (current):** body `{shape, audience?, length?, topic?, outputs?, clarifications?}`. `shape` ∈ `post | testimonials | milestone | feedback | customers | checkin | team | references` (the deck since 2026-10-25; the retired `validate | decide | rank | temperature | ideas | stories | headcount` are still accepted so old parlos and cached frontends work; ids in `backend/src/services/shapes.ts`), `audience` ∈ `group | network | friends | team | customers | community | strangers` (default `group`), `length` ∈ `one | few | deep` (1 / 4 / 8 questions, default `few`), `topic` is optional since 2026-10-25 (the creation screen has no blank; ≤300 chars when an API caller sends one, appended to the shape sentence). `timing` (since 2026-10-25) is the third chip row's pick: `today | week | open` for the deadline shapes (post, testimonials, milestone, feedback, team), `daily | weekly` for the check-in, `once | probe` for customer interviews; a chip from the wrong row or none at all becomes the row's default (`resolveTiming`), and a shape with no row (references) stores NULL. Stored in `surveys.timing` (migration `0016_timing.sql`); `TIMINGS` in `backend/src/services/shapes.ts` carries each chip's close delay, nudge lead and brief line. `outputs` is what the agent should make beyond the report: an array of ids from `backend/src/services/outputs.ts` (`sheet | clips | post | thread | carousel | episode`, the content-type deck since 2026-10-25; the channel ids of the 2026-10-15 deck are still accepted and mapped by `LEGACY_OUTPUTS`: `instagram → carousel`, `linkedin → post`, `tiktok → clips`, `podcast → episode`, `drive | table → sheet`, `other` dropped; unknown ids dropped, canonical order). The route composes the prose brief with `composeBrief()` (sentence + what should come back + who/tone + how the questions should work + length + an "Also make" line with per-output notes that shape the asks: episode = voice-only told moments, clips = told moments plus an optional video ask, carousel = one quotable line plus an optional photo ask, post/thread = one quotable line, sheet = comparable answers) and stores it in `surveys.brief`, with `output_shape`, `audience_kind` (migration `0013_output_shape.sql`) and `outputs` as JSON (migration `0014_outputs.sql`) alongside. Producers for the outputs do not exist yet; the pick is intent, and the agent's `/brief.md` carries it under "Also make, after every round".
- **Free brief ("Something else"):** body `{brief: string, clarifications?}`. Stored as is; `output_shape = 'other'`.
- **Legacy flow (MCP server):** body optional `{textAnswers?: {audience?: string, gather?: string}}`; transcribes `surveys/{id}/audience|gather.webm` from R2 for whatever is missing.

`clarifications` (max 40, 4k chars each) are persisted in `brief_clarifications`.

All modes **replace** round 1's questions (delete + insert), so a rebuild doesn't pile up duplicates. **Since 2026-10-25 the build is go-live**: there is no review screen, the share link works as soon as this returns, and `scheduleRound1Close()` sets round 1's `closes_at` from `surveys.timing` and asks the `GroupAgent` (`scheduleClose`, via `waitUntil`) to hold the alarms. Defaults to 5 questions in free-brief mode, 3 in legacy mode, unless the brief asks for a number (the composed brief always does).
Returns:
```json
{
  "title": "string",
  "questions": [{"text": "string", "hint": "string", "type": "voice | photo | video"}],
  "brief": "string (the brief the questions were built from; empty in legacy mode)"
}
```

### POST /api/surveys/:id/questions/adjust
_(API only since 2026-10-25: the review screen that called it is gone.)_
Review-screen chips: the draft on screen rewritten in place. Body `{kind: "shorter" | "playful", questions: [{text, hint?, type?}]}` (≤20; kinds are a server-side allowlist, `ADJUST_KINDS` in `services/ai.ts`). Returns the same number of questions in the same order with the same media types, only the wording changed; a slot the model skipped keeps its old text. Works from `surveys.brief` for context (falls back to "(no brief)"). Nothing is saved: the review screen persists with `PUT /questions` on confirm. Rate limited 300/hr per IP. Server event `survey_questions_adjusted {kind, questionCount}`.
Returns: `{questions: [{text, hint, type}]}`

### POST /api/surveys/:id/questions/swap
_(API only since 2026-10-25: the review screen that called it is gone.)_
Review-screen swap: one different question for a slot. Body `{index: number (0-based), questions: [{text, type?}]}` — the draft on screen (≤20). Works from the `brief` + `brief_clarifications` stored by `/generate` (400 before a generate), asks for a replacement that covers an angle the other questions don't (`generateReplacementQuestion` in `services/ai.ts`, code prompt, not KV). Nothing is saved: the review screen persists the whole list with `PUT /questions` on confirm. Rate limited 300/hr per IP.
Returns: `{question: {text: "string", hint: "string", type: "voice | photo | video"}}`

### POST /api/surveys/:id/questions/revise
_(API only since 2026-10-25: the review screen that called it is gone.)_
The checkpoint after "Sharpen it" ("Update with feedback"): the draft on screen edited in the light of the creator's follow-up answers. Body `{questions: [{text, hint?, type?}], clarifications: [{question, answer}]}` (draft ≤20, clarifications ≤40; both required). Unlike `/adjust` the count may change (within two of the draft) and questions may be reworded, dropped, added or reordered; the prompt calls it an edit, not a rewrite (`reviseQuestions` in `services/ai.ts`, Cerebras with the Workers AI fallback). Persists the clarifications to `brief_clarifications` so the agent and `/swap` see them; the draft itself is not saved (the review screen persists with `PUT /questions` on confirm). Rate limited 300/hr per IP. Server event `survey_questions_revised {clarificationCount, before, after}`.
Returns: `{questions: [{text, hint, type}]}` with hints renumbered.

### PUT /api/surveys/:id/questions
Update survey questions after generation. Body: `{questions: [{text: string, hint?: string}]}`.
Deletes existing questions and inserts replacements with correct sort_order. No UI caller since 2026-10-25 (the review screen is gone); an API caller editing round 1 restarts the deadline (`scheduleRound1Close`, below).
Returns:
```json
{
  "questions": [{"id": "string", "survey_id": "string", "sort_order": number, "text": "string", "hint": "string | null"}]
}
```

### POST /api/surveys/:id/intro/upload-url
Fresh one-time presigned URL for the creator's voice intro (`surveys/{id}/intro.webm`). Needed because the upload URLs from `POST /api/surveys` expire after 10 min and the intro is recorded at the end of the flow.
Returns: `{uploadUrl: "string"}`

### PUT /api/surveys/:id/intro
Mark the intro as uploaded. Body: `{durationMs: number}`. Checks the object exists in R2 (409 if not), writes `intro_r2_key` + `intro_duration_ms` on the `surveys` row, and transcribes it with Whisper via `waitUntil()` into `intro_transcript`.
Returns: `{success: true, durationMs: number}`

### POST /api/agent/parlos
**The one-call path for agents** (2026-10-25): what `parlo.me` tells an AI agent to do instead of driving the UI. Body `{brief?, opener_audio_url?, title?}`, at least one of the first two (brief ≤ 20k chars). No auth needed: without a key the owner is a fresh anonymous user and the answer carries a **`claimLink`** (`parlo.me/claim/<token>`, KV `claim:{token}` → surveyId, 7-day TTL, burned on use) for the person the agent acts for, plus the owner's **`apiKey`** to send as `X-Parlo-Api-Key` next time (then the key's user owns the parlo and `claimLink` is `null`). Chains create → `saveIntroFromUrl` (when a URL is given; a failure sets `openerError` and does not stop a build that has a brief) → `generateQuestionsFromBrief` (brief = typed brief, else the opener's transcript, else `FALLBACK_BRIEF`) → go-live (`scheduleRound1Close`). Rate limited 30/hr per IP (`agent-create`) on top of `survey-create` 100/hr. Server events `survey_created {via: "agent"}` and `survey_questions_generated {via: "agent", briefSource, hasOpener, userAgent}`. ~2 s end to end.
Returns 201:
```json
{
  "parloId": "string", "code": "string", "title": "string",
  "shareLink": "https://parlo.me/s/<slug>-<code>",
  "whatsappShareLink": "https://wa.me/?text=…",
  "dashboardLink": "https://parlo.me/d/<dashboardCode>",
  "claimLink": "https://parlo.me/claim/<token> | null",
  "openerLink": "https://wa.me/12015789837?text=opener%20<code>%20<token>",
  "answerLink": "https://wa.me/12015789837?text=answer%20<code>",
  "apiKey": "pk_…",
  "questions": [{"text", "hint", "type"}],
  "briefSource": "brief | opener_transcript | fallback",
  "opener": {"durationMs": 0, "transcript": ""} ,
  "openerError": "string | null",
  "openerRequest": {"why": "…", "link": "<openerLink>", "askThePerson": "the 30–60 s voice-note script + the link", "alternatively": "POST …/intro/from-url with the ids filled in"} ,
  "next": ["1. post shareLink", "2. ask for the voice note (script inline)", "3. send claimLink", "4. keep apiKey"]
}
```
`openerLink` (since 2026-10-25, later that night) is a `wa.me` deep link into Parlo's own WhatsApp number with `opener <code> <token>` prefilled (`buildBotChatUrl` in `services/whatsapp.ts`; KV `opener:{token}` → surveyId, 7 days, minted on every agent create). **Agents relay links and drop asks** (two Instinct runs ignored a worded request for a voice note, every link reached the chat), so the voice note travels by link: the person taps it, the webhook binds their number to the parlo, their next voice note becomes the opener and, the number being proof, an anonymous owner seat becomes theirs (`claimOwnership`), no OTP. `openerRequest` is `null` when an opener was saved; otherwise it carries the link, the words to forward (`OPENER_ASK`) and the `intro/from-url` alternative for an agent that holds the file. `next` step 2 says to send `openerLink`. The MCP `create_parlo` tool calls this endpoint (authed, so no `claimLink`) and formats the reply.
400 when there is nothing to build from (the error names what to send), 429 over the limit; opener problems are reported in `openerError`, not as a status.

### GET /api/claim/:token, POST /api/claim/:token
The claim link. GET → `{title, code, alreadyClaimed}` (404 `This claim link has expired` when the token is unknown or used). POST takes the same proof as `/claim` (API-key header, `{idToken}` or `{proof}`), runs the shared `claimSurveyAs()` (owner seat moves to the verified user; 403 if the parlo already belongs to someone else) and deletes the token on success. Returns `{ok, apiKey, userId, phone, dashboardCode}`. The page is `frontend/src/pages/ClaimPage.tsx` (`/claim/:token`): a device with an API key claims silently and lands on `/d/:dashboardCode?tab=agent`; otherwise `PhoneScreen` → `OtpScreen` → claim. Events `claim_link_opened`, `claim_completed {method}`.

### POST /api/surveys/:id/intro/from-url
The opener from a URL, for agents that hold the creator's voice note as a link rather than as bytes in a browser (the MCP `create_parlo` tool). **API key required, owner only** (the Worker fetches whatever it is given). Body `{url}`: absolute https; the Worker fetches it with redirects (20 s timeout, `User-Agent: Parlo/1.0`), accepts `audio/*`, `video/*`, `application/ogg`, `application/octet-stream` or no content type (415 otherwise; an HTML page is refused), caps it at 12 MB (413), stores it under `surveys/{id}/intro.webm` with the upstream content type, and transcribes it **synchronously** with Whisper so the caller can use the words as the brief. `durationMs` comes from Whisper's last word timing (`transcribeAudioDetailed` in `services/ai.ts`; 0 when Whisper gave none). Rate limited 60/hr per IP. Upstream failures are 502 (`Audio URL answered <status>`). A URL on `api.parlo.me` itself fails with 522: a Worker cannot fetch its own zone (pitfall 33).
Returns: `{success: true, durationMs, transcript, bytes, contentType}`

### DELETE /api/surveys/:id/intro
Removes the R2 object and nulls the three `intro_*` columns. Returns `{success: true}`.

### GET /api/s/:code?t=<memberToken>
Get a parlo for a participant. `t` (optional) is a member token from a personal link or a previous visit; it personalises the view. Returns:
```json
{
  "id": "string",
  "title": "string | null",
  "status": "string",
  "questions": [{"id", "survey_id", "sort_order", "text", "hint", "question_type", "round_id", "target_user_id"}],
  "audioKeys": [],
  "intro": {"audioUrl": "string (signed, 1h)", "durationMs": number, "transcript": "string | null"} | null,
  "visibility": "private | open",
  "round": {"number": number, "kind": "poll | probe", "closesAt": "string (ISO) | null"} | null,
  "member": {"role": "owner | admin | member", "displayName": "string | null", "hasAnswered": boolean} | null,
  "report": {"available": boolean, "unlocked": boolean, "markdown": "string | null", "updatedAt": "string | null"},
  "memberCount": number
}
```
`questions` are the asks still **pending for this visitor**: every ask in a sent round aimed at everyone (or at this member), minus what they already answered in a submitted response. Anonymous visitors get every "everyone" ask from every sent round. `report.markdown` is filled only when `unlocked` (a member who has answered at least once, or an owner/admin). Frontend maps this in `useGetSurvey(code, token)`.

### POST /api/s/:code/responses?t=<memberToken>
Start a response session. With a valid token the row gets `user_id` and only the member's pending asks get upload URLs (so probes aimed at them are included). Returns:
```json
{
  "id": "string",
  "code": "string (8-char)",
  "uploadUrls": {"<questionId>": "string (presigned URL)"}
}
```

### POST /api/responses/:id/submit
Submit response. The route resolves identity (API key, `idToken`/`proof`), then calls `submitResponse()` in `services/responses.ts`, which is shared with the WhatsApp bot (identity stamp, `response_answers` rows from what is in R2, managers' Inbox, background transcription). Body: `{phone?: string, firstName?: string, lastName?: string, idToken?: string, proof?: string}`; the API key header counts too.
**Answering is joining**: a *proven* identity (API key → user; else `idToken`/`proof` → phone → user; else the member token the session was started with) finds or creates a `users` row and an active `group_members` row (role `member`; a removed member stays removed). `phone` in the body is display-only and ignored for identity: without proof the answer is stored anonymously and `memberToken` is null. The frontend sends `apiKey` from the device record (`useSubmitResponse`). Stamps `visibility_at_submit` with the parlo's current visibility. Creates `response_answers` rows by checking R2 for uploaded audio (.webm then .wav) per question (probes aimed at someone else are skipped). Notifies owner + admins (Inbox), then transcribes in the background; when transcription finishes, `services/transcription.ts` hands the transcripts to the group agent (`ingestResponse`).
Returns: `{success: true, id: "string", memberToken: "string | null", visibility: "private | open"}` — the frontend stores `memberToken` per code (`lib/memberToken.ts`).

### POST /api/responses/:id/refresh-urls
Generate fresh presigned upload URLs for an existing response session (e.g. after tokens expire).
Returns 404 if response not found, 400 if already submitted.
Returns:
```json
{
  "uploadUrls": {"<questionId>": "string (presigned URL)"}
}
```

### GET /api/og/:code.png
Open Graph preview image for share URLs. Generates a unique 1200×630 PNG per survey in the Parlo1 style: black canvas with a subtle seeded tile texture (neutral-4), one flat neutral-2 card (radius 42, no border), the title in Open Runde Bold (fetched from `parlo.me/fonts/open-runde/OpenRunde-Bold.woff` at render time and edge-cached; falls back to the library default font if unavailable), and an accent pill with black text.
- `:code` may be a slug like `lemonade-pirates-2rbee8p6` — only the trailing 6-12 char alphanumeric segment is used.
- Uses `workers-og` (Satori port for Workers) to render an HTML/CSS template to PNG.
- Cached at the edge: `Cache-Control: public, max-age=86400, s-maxage=604800`.
- Surfaced via `frontend/functions/s/[code].ts` Pages Function as the `og:image` meta tag.

### POST /api/otp/send-whatsapp
Send OTP code via WhatsApp (fallback when SMS doesn't arrive). Body: `{phone: string}`.
Rate limited: 5 per phone per hour.
Returns: `{sent: true}`

### POST /api/otp/verify-whatsapp
Verify a WhatsApp OTP code. Body: `{phone: string, code: string}`.
Code is deleted from KV after successful verification (one-time use, 5-min TTL).
Returns: `{verified: true, proof: "string"}` or `{verified: false}`. `proof` is a random token (KV `phone-proof:{token}` → phone, 10-min TTL) the client presents to the routes below instead of a phone number.

### Phone proof: POST /api/auth/login, POST /api/surveys/:id/claim
Identity is never read from a phone number in a request body (see pitfall 22). A route that attaches a phone to a user accepts, in this order:
1. an API key (`X-Parlo-Api-Key`) — a device that passed OTP before;
2. `{idToken}` — the Firebase ID token the browser gets from `confirmationResult.confirm(code)` then `user.getIdToken()`; verified server-side (RS256 against `securetoken@system.gserviceaccount.com` JWKS, cached in KV; `aud` = `FIREBASE_PROJECT_ID`, `iss`, `exp`, `iat`, `phone_number` claim);
3. `{proof}` — the WhatsApp proof token.
Frontend type: `PhoneProof = {idToken} | {proof}` (`api/client.ts`); `OtpScreen.onNext(phone, proof)` hands it up.

- `POST /api/auth/login` body `{idToken?|proof?, firstName?, lastName?}` → `{apiKey, userId, creatorId, phone, created}`. Creates the user if the phone is new and mints an API key if they have none, so members who joined by answering can log in too. 401 `{error, code}` without a valid proof. Both pages store the key in `localStorage parlo-device-auth` (`saveDeviceAuth(phone, apiKey)`); a device record **without** an API key is cleared on load and the person verifies again.
- `POST /api/surveys/:id/claim` body `{idToken?|proof?, name?}` or just the API-key header → `{ok, apiKey, userId, phone}`. Moves the owner seat from the anonymous creator to the verified user (`claimOwnership` / `claimOwnershipForUser` in `services/groups.ts`). 403 when the parlo already belongs to a different verified user.

### GET /api/auth/validate
Validate an API key. Requires `X-Parlo-Api-Key` header or `Authorization: Bearer pk_...`.
If valid, returns `{ "valid": true, "creatorId": "string", "userId": "string" }`.
If no key or invalid key, returns 401 `{ "valid": false }`.

### GET /api/d/:dashboardCode
Creator dashboard data. Returns response list with signed audio URLs + transcriptions.
Each answer includes `transcription` (string | null) and `transcriptionStatus` ("pending" | "completed" | "failed").

### GET /api/r/:code
Public results (open surveys only). Returns first names + audio.

### POST /api/webhooks/whatsapp
Kapso webhook receiver. Parses Kapso v2 (single and buffered) and raw Meta payloads into `{kind: text|audio, text, from, contactName, media}` (`toInbound`). Handles, in this order:
- `opener <code> <token>` (the `openerLink` deep link; since 2026-10-25) → looks up KV `opener:{token}`, checks the code and that the parlo's owner is anonymous or this number (`from` is digits, normalised with a leading `+`), writes KV `wa-opener:{from}` = `{surveyId, token}` for ten minutes (an hour caught a stray voice note on the wrong parlo the first night), replies with the voice-note ask. Expired token → "ask your agent for a fresh one"; someone else's parlo → refused.
- `answer <code>` / `join <code>` (the `answerLink` in an invitation; since 2026-10-26) → `startAnswerSession`: the parlo by code (active), the sender's user by phone (or none), `pendingAsksFor` filtered to voice asks (photo/video asks are pointed at the web page), a `responses` row, KV `wa-answer:{from}` = `{surveyId, code, title, responseId, userId, questions, index, answered}` for 24 h (the `wa-opener` session is cleared), then the opener as an **audio message** when WhatsApp can play the file (`isWhatsAppPlayableAudio`: OGG/MP3/M4A/AAC/AMR, so WhatsApp-recorded openers play and web WAV ones fall back to the transcript as text), then one message with the visibility line and question 1. Each voice note is stored at `responses/{responseId}/{questionId}.webm` **and transcribed on receipt** (Whisper, a few seconds, the text kept in the session; the slot is the first question without a transcript, so two notes sent quickly do not collide); after the last one `finishAnswerSession` → `upsertUserByPhone` + `submitResponse(…, "whatsapp", transcripts)`, which inserts the rows already `completed` and hands the response to the agent **in the request** (`ingestIntoAgent`), and a reply with the personal link. Text during a session: `skip`/`next`, `stop`/`cancel`, anything else is a nudge back to the mic. Nothing pending → "answered everything" (with the report link when it exists). Events `whatsapp_answer_link_opened`, `whatsapp_answer_saved`, `response_started {source: whatsapp}`.
- a **voice note** (`type: audio`) → with a `wa-answer` session: the answer above; else with a `wa-opener:{from}` session (a voice note with no session is bounced with "tap the opener link first"): `downloadInboundMedia` (Kapso's `message.kapso.media_url` with the API key, else `GET /{media_id}` for a 5-minute URL), `storeIntroBytes` (R2 intro key, Whisper now, the three `intro_*` columns), `claimOwnership` for the number when the owner was anonymous, both KV keys deleted, reply with the transcript's first line, the share link and the dashboard link. Without a session → "tap the opener link first". Events `whatsapp_opener_link_opened`, `whatsapp_opener_saved {claimed}`, `whatsapp_opener_failed`.
- `response <code>` → participant confirmation + creator notification
- `parlo <code>` / `notify me about parlo <code>` (the prefilled message from the ready screen; `survey <code>` still accepted) → creator notification opt-in
- Unknown → fallback message
Free-form replies are allowed because the person messaged first (24 h service window). `services/intro.ts` holds `introKey`, `storeIntroBytes`, `saveIntroFromUrl`, the opener-token key and TTL.

Requests must carry a valid `X-Webhook-Signature` (hex HMAC-SHA256 of the raw body with `KAPSO_WEBHOOK_SECRET`); otherwise 401. If the secret isn't set the endpoint returns 500 rather than accepting unsigned calls.

### GET /api/my/surveys
Every parlo the authenticated user is an active member of, shaped for the home screen's chat-style list. Requires `X-Parlo-Api-Key` header or `Authorization: Bearer pk_...`. Returns 401 if no valid API key provided. **Sorted by `lastActivityAt` desc** (the frontend pins rows that need the viewer on top, see `lib/parloRow.ts`). All timestamps are ISO (the handler normalises D1's `datetime('now')` strings, see pitfall 25).
Returns:
```json
{
  "surveys": [{
    "id": "string",
    "code": "string",
    "dashboardCode": "string (empty for role 'member')",
    "title": "string | null",
    "status": "string",
    "visibility": "private | open",
    "createdAt": "string (ISO)",
    "role": "owner | admin | member",
    "memberToken": "string (your personal-link token)",
    "questionCount": "number",
    "memberCount": "number",
    "responseCount": "number (submitted only)",
    "newCount": "number (unread submitted responses; 0 for members)",
    "latestResponseAt": "string | null",
    "reportUpdatedAt": "string | null",
    "reportPreview": "string | null (first line of prose from report_md, ≤160 chars, markdown stripped)",
    "lastActivityAt": "string (newest of created, last answer, report, a round ≥2 sent, a proposal)",
    "round": {"number": 1, "kind": "poll | probe", "sentAt": "string | null", "closesAt": "string | null", "answered": "number (distinct people)", "targets": "number"} ,
    "proposedRound": {"number": 2, "kind": "poll | probe", "createdAt": "string"},
    "pendingAsks": "number (asks waiting for this viewer; members only, always 0 for owner/admin)",
    "faces": [{"userId": "string", "name": "string | null", "photoUrl": "string | null"}]
  }]
}
```
`round` is the latest **sent** round or `null`. `targets` = members minus the owner for a poll, distinct targeted members for a probe; the frontend ignores it for round 1 (open invite, no fixed audience). `proposedRound` is `null` for members. `faces` = up to three *other* members, photo-holders first then newest joiners; `photoUrl` is the stable `GET /api/users/:userId/photo` URL. Three extra statements per parlo run in one `db.batch()` (`services/home.ts`).

### POST /api/my/surveys/:surveyId/read
Mark every answer in a parlo as read for the authenticated member (API key). Upserts `creator_survey_cursors.last_read_at = datetime('now')` (SQLite format on purpose: `new_count` compares it with `responses.submitted_at`, which D1 fills the same way, see pitfall 25). 404 if not an active member. Returns `{ok: true}`. The dashboard calls it on open.

### GET /api/users/:userId/photo
A member's LinkedIn photo by opaque user id (for the home list's avatar clusters and the viewer's own profile; there is no phone-keyed photo route any more). Mirrors the LinkedIn CDN URL into R2 on first request (participants who connected LinkedIn only have the CDN URL on file), then streams from R2 with `public, max-age=3600, s-maxage=86400`. 404 when the user has no photo.

### LinkedIn (`backend/src/routes/linkedin.ts`, API key required except the callback)
- `POST /api/auth/linkedin/start` body `{returnTo?: "/s/abc"}` → `{url}`; the browser goes there (`startLinkedIn(apiKey, returnTo)` in the client). The user id and return path ride in the OAuth `state` (KV, 5 min). The old `GET …/start?phone=` is gone.
- `GET /api/auth/linkedin/callback` → updates the `users` row by id and redirects to `FRONTEND_ORIGIN + returnTo + ?linkedin=connected` (`?linkedin=error|expired|not_found` otherwise).
- `GET /api/auth/linkedin/profile` → `{connected, name?, email?, photoUrl?}` for the caller; `photoUrl` is the `GET /api/users/:userId/photo` URL.
- `POST /api/auth/linkedin/disconnect` → clears the caller's own LinkedIn fields.

### Groups: members, roles, settings (`backend/src/routes/groups.ts`, API key required)
- `GET /api/my/surveys/:id/members` → `{members: [{userId, role, phone (managers only), firstName, lastName, displayName, linkedinName, linkedinPhotoUrl, linkedinEmail, joinedAt, responseCount}], you: {userId, role}}`
- `POST /api/my/surveys/:id/members/:userId/role` body `{role: "admin" | "member"}` — owner: any; admin: promote only
- `DELETE /api/my/surveys/:id/members/:userId` — owner: anyone but self; admin: members only. The owner can never be removed.
- `POST /api/my/surveys/:id/transfer` body `{userId}` — owner only; old owner becomes admin, `surveys.creator_id` follows the owner
- `PUT /api/my/surveys/:id/settings` body `{visibility?: "open" | "private", title?}` — owner/admin
- Permission rules live in `services/groups.ts` (`setMemberRole`, `removeMember`, `transferOwnership`, `claimOwnership`); they throw `GroupPermissionError` with the right status.

### The agent and rounds (API key, owner/admin)
- `GET /api/my/surveys/:id/agent` → `{state, files: [{path, updatedAt, bytes}], report, reportUpdatedAt, memory, rounds: [{...round, asks: [{id, text, hint, type, sortOrder, targetUserId, targetName}]}], visibility}`
- `POST /api/my/surveys/:id/agent/digest` → runs `runDigest()` now; `{ok, report, answersRead, provider, model, error?}` (502 when the model fails)
- `GET /api/my/surveys/:id/agent/file?path=/report.md` → one file from the agent's file system
- `GET /api/my/surveys/:id/rounds` → all rounds with asks
- `POST /api/my/surveys/:id/rounds/propose` body `{kind?: "poll" | "probe", hint?}` → the agent plans the next round (status `proposed`, replaces any earlier proposal)
- `PUT /api/my/surveys/:id/rounds/:roundId` body `{asks: [{id, text, hint?}]}` — edit a proposed round's ask texts
- `POST /api/my/surveys/:id/rounds/:roundId/approve` → `sendRound()`: status `sent`; Inbox notification + WhatsApp template `parlo_new_round` (personal link) to every member for a poll, only the targeted members for a probe. On a timed parlo the round gets `closes_at` = now + the timing's delay and the agent holds the alarms (`scheduleClose`). `{ok, round, notified}`. Check-in rounds after the first do not pass through here: the agent sends them itself when the previous one closes.
- `POST /api/my/surveys/:id/rounds/:roundId/reject`

### Exports (API key, owner/admin)
The agent is an MCP *client* (Agents SDK `this.addMcpServer` / `this.mcp`). The owner connects MCP servers as destinations; the agent exports with their tools. Registrations and OAuth tokens live in the agent's own SQLite (`cf_agents_mcp_servers`), not D1.
- `GET /api/my/surveys/:id/connections` → `{connections: [{id, name, url, state, tools: [names], error, authUrl}]}`; `state` ∈ `authenticating | connecting | connected | discovering | ready | failed`.
- `POST /api/my/surveys/:id/connections` body `{name, url}` (https, or http://localhost) → `{id, state, authUrl, connection}`. `id` = slug of the name (so tools read `tool_<id>_<name>`); a second server with the same name is a 400. `authUrl` set ⇒ send the browser there; the provider redirects to the callback below and the agent then redirects to `/d/:dashboardCode?tab=agent&connection=connected|failed[&reason]`. `callbackHost` is `API_ORIGIN` (wrangler dev reports the custom domain, pitfall 20).
- `DELETE /api/my/surveys/:id/connections/:connectionId`
- `POST /api/my/surveys/:id/agent/export` body `{instruction?}` → runs `runExport()` now: `{ok, summary, toolCalls, destinations, provider, model, error?}`; 502 when `ok` is false (no ready destination, no tool was called, model failure). The outcome is also filed as `/exports/<timestamp>.md` and mirrored into `state.lastExportAt / lastExportSummary / lastExportError`.
- `PUT /api/my/surveys/:id/agent/settings` body `{autoExport: boolean}` → `runDigest()` schedules `runAutoExport` 5 s after each report when on.
- `GET /api/my/surveys/:id/export.csv` → `text/csv` attachment, columns `round, member, question, kind, answer, answered_at, duration_seconds, response_id` (`services/exportCsv.ts`; the same CSV is what the agent hands to the destination). Needs the API-key header, so the frontend fetches it and triggers a download (`downloadAnswersCsv`).
- `GET /api/mcp/callback/:surveyId` (no auth) → forwards the request to the parlo's `GroupAgent` (`agent.fetch`), where the SDK matches it to the pending authorisation by `state` and refuses anything else (404).

### Member-facing (personal link, no API key)
- `GET /api/s/:code/report?t=` → `{available, unlocked, markdown, updatedAt, role}`; unlocked = answered at least once (or owner/admin)
- `GET /api/s/:code/feed?t=` → open groups only: `{items: [{id, responseId, userId, name, submittedAt, roundNumber, questionId, questionText, questionType, durationMs, transcription, transcriptionStatus, audioUrl, imageUrl, videoUrl}]}` — only responses with `visibility_at_submit = 'open'`

### Admin API (protected by Cloudflare Access)
- GET /api/admin/prompts — list prompts
- GET /api/admin/prompts/:name — get prompt with version history
- POST /api/admin/prompts/:name — save new version `{content, createdBy?}`
- POST /api/admin/prompts/:name/revert — revert `{version: number}`
- GET /api/admin/prompts/seed — initialize defaults

## Creator flow (the opener)

```
welcome → intro (record the opener, required) → phone → otp → linkedin → building (last) → ready
```

Cut down to this on 2026-10-25 ("make this dumb af", GROWTH.md). The shape cards, the sentence with chips, the outputs cards, the free brief, the review screen and every follow-up loop are gone from the frontend; the backend keeps the shape / audience / length / timing / outputs vocabularies and the `/clarify`, `/questions/*` routes for the API and for parlos made before.

- **"+" / "Create a parlo"** creates the survey (`POST /api/surveys`) and goes straight to the opener.
- **The opener** (`components/creator/IntroScreen.tsx` with `required`, label "Your opener", heading "Record an opener for the group", prompts "Who you are / What you want to know from them / What you'll do with it"): the one creative step. A ≤60 s voice note that participants hear on the welcome screen, **and the brief the agent builds the questions from**. Tap-to-record, playback via `VoiceNotePill` with a bin to re-take, "Use this opener"; no skip (`required` hides it). `handleIntroContinue` sends the trimmed take to Whisper (`POST /transcribe`, `transcribeAudio`, promise kept in `pendingTranscript`) and uploads it in the background (`fetchIntroUploadUrl` → `uploadAudioBlob` → `saveIntro`). Back goes to the landing (or the home list). Test ids: `intro-record`, `intro-stop`, `intro-take`, `intro-use`.
- **Phone / OTP / LinkedIn**: unchanged; a verified device skips phone and OTP.
- **Building** (`BuildingAgentScreen`, last): `handleGenerate` awaits the opener's transcript and posts `{brief: <transcript>, clarifications: []}` to `/generate` (the free-brief mode: `output_shape = 'other'`, no timing, no outputs, five questions unless the opener asks for a number). An empty transcript falls back to `OPENER_FALLBACK_BRIEF` so the build never dead-ends. The build is go-live. The LinkedIn-success screen's Continue goes here when a creation session was restored from the OAuth redirect.
- **Ready**: unchanged. Reaching it fires `create_share_reached {surveyId, shape: "opener"}` once per parlo.
- Analytics on the way: `survey_creation_started {mode: "opener"}`, `intro_recorded` / `intro_skipped` (the latter can no longer fire), `survey_questions_generated`, `create_share_reached`; server-side `survey_questions_generated {source: brief}`. `create_shape_picked`, `create_audience_picked`, `create_outputs_picked`, `review_*` and `clarify_*` stopped on 2026-10-25.
- Drafts (a parlo with no questions yet) resume at the opener from the home list.
- The legacy two-question flow (`CREATION_QUESTIONS`, audience/gather) is no longer reachable from the UI; the MCP server's legacy `create_survey` tool still uses the legacy generate mode.
- **parlo.me tells agents not to tap (2026-10-25).** A plain fetch of `parlo.me` used to return the empty SPA shell. Now `frontend/index.html` carries a `<section id="for-agents">` outside `#root` (clipped off-screen for people, read by curl, crawlers and DOM-reading agents) with the one-call `POST /api/agent/parlos` curl, what the answer holds and the MCP URL; `CreateLanding` shows a one-line footer ("AI agent? Read parlo.me/llms.txt instead of tapping"); `frontend/public/llms.txt` is the full agent guide (API, MCP, what participants see, vocabulary); `public/robots.txt` points at it; `public/.well-known/mcp/server-card.json` is a draft-SEP-1649-shaped card for the MCP server (experimental, no consumer yet). The `<title>` is "Parlo — Group chats, run by an agent" (the April "Voice Surveys" copy is gone from `index.html`; the OG route and the `/s/*` Pages Function keep their own fallbacks). Static files beat the `/*  /index.html  200` redirect on Pages, which is why `/llms.txt` is a real file now and not HTML (pitfall 19). Keep the three copies of the agent instructions (index.html, llms.txt, the API's `next` field) saying the same thing.
- **Agents create the same way (2026-10-25).** The MCP server (`mcp/`, `mcp.parlo.me/mcp`, OAuth → the user's API key) has `create_parlo {brief?, opener_audio_url?, title?}`: `POST /api/surveys` (the key's user owns it), `POST …/intro/from-url` when a voice-note URL is given (the recording becomes the opener and its transcript stands in for a missing brief), then `POST …/generate {brief}`; the parlo is live and the tool returns the slugged `shareLink`, a `whatsappShareLink`, the dashboard link, the questions, `briefSource` (`brief | opener_transcript | fallback`) and `opener {durationMs, transcript}`. The fallback brief mirrors `OPENER_FALLBACK_BRIEF`. An opener that cannot be fetched does not stop the build when a brief was given (`openerError` in the result). `create_survey` (audience + gather) stays for old clients, marked legacy. This is the first entry point of the agent-as-creator direction (GROWTH.md, 2026-10-25); WebMCP and the REST API are the other two.
- **Consequences to know.** Nothing on a new parlo carries a shape, an audience, a length, a deadline or an output pick: `surveys.output_shape` is `other`, `timing` is NULL (so no round closes and no nudge fires), `outputs` is `[]`. The agent's report shape comes from the brief alone. The deadline, cadence and outputs machinery stays live for API callers and older parlos.

## Creator voice intro (participant side)

`useGetSurvey` maps `intro` from `GET /api/s/:code` to `survey.intro?: {audioUrl, durationMs, transcript?}`. `WelcomeScreen` renders a read-only `VoiceNotePill` ("A hello from the person asking") between the description and the meta row when it's set. `VoiceNotePill`'s `onDelete` is optional — omit it for read-only playback. Columns: `surveys.intro_r2_key`, `intro_duration_ms`, `intro_transcript` (migration `0011_survey_intro.sql`).

## Groups, rounds and the agent

Decided 2026-10-10 (see memory `project_agent_group_pivot`). Migration `0012_groups.sql`.

**Identity.** One table, `users` (renamed from `creators`; `participants` + `survey_participants` are legacy, backfilled and no longer written). `users.api_key` authenticates owners/admins/members alike; the Hono context variable is `userId` (`middleware/auth.ts`, type `AuthVariables`). `surveys.creator_id` always equals the current owner.

**Membership and roles.** `group_members (survey_id, user_id, role, access_token, joined_at, invited_by, removed_at)`. Exactly one `owner`; `admin`s and `member`s. Owner transfers ownership, promotes/demotes admins, removes anyone but themself. Admins promote members and remove members, never the owner or other admins. Answering is joining: the submit route adds a `member` row. Removal is soft (`removed_at`) and sticky.

**Member tokens.** `group_members.access_token` is the secret in personal links (`parlo.me/s/{code}?t=…`). The participant page reads `?t=` (then strips it from the URL) or `localStorage parlo-member:{code}`, sends it on `GET /api/s/:code` and `POST /api/s/:code/responses`, and stores the one `submit` returns. Never trust a phone header for identity; only the token.

**Visibility (two states, not a matrix).** `surveys.visibility`: `private` (default — only owner, admins and the agent hear raw answers; every member gets the agent's report) or `open` (everyone hears everyone, with names). Copy for both lives in `frontend/src/lib/visibility.ts`; the consent screen always shows it. Each response stamps `visibility_at_submit`, and the open-group feed only ever shows responses stamped `open`, so loosening later never exposes earlier answers. There is deliberately no anonymous-but-visible mode: voices are recognisable, the agent's paraphrase is the only real anonymisation.

**Rounds.** `rounds (id, survey_id, number, kind poll|probe, status proposed|sent|rejected|closed, rationale, proposed_by, sent_at, closes_at, closed_at)`. **Deadlines (2026-10-25):** a timed parlo (`surveys.timing`) gives every sent round a `closes_at` (set at go-live and at approve, `closesAtFor()` in `services/shapes.ts`) and the agent holds two alarms per round via the Agents SDK scheduler: `nudgeRound` a little before (Inbox + the `parlo_new_round` template to `membersPendingFor()`, the members the round is still waiting on) and `closeRound` at the deadline (status `closed`, `closed_at`, `runDigest()`, an Inbox line to owner/admins with who did not answer, and for the check-in cadence `proposeRound()` with the same asks followed by `sendProposedRound()`, which sends it with no approval, decided 2026-10-25: the owner gets an Inbox line "Round N went out" and the `round_auto_sent` event fires). `sendRound()` in `services/rounds.ts` is the one send path (status, deadline, Inbox, the `parlo_new_round` template), shared by the approve route and the agent. `scheduleClose()` cancels the round's earlier alarms first, so a moved deadline never fires twice; `runNightly()` closes any `overdueRounds()` whose alarm was lost. A closed round's asks leave `pendingAsksFor`, so late answers are not possible. Events `round_nudged`, `round_closed`. Every ask is a `survey_questions` row with `round_id` and `target_user_id` (NULL = everyone). Round 1 is the creator's original set (`ensureRound1`); `/generate` and `PUT /questions` only replace round 1. `pendingAsksFor(db, surveyId, userId)` in `services/rounds.ts` computes what a visitor still has to answer. Owner approves at round level; `proposeRound` replaces any still-proposed round.

**The agent (`GroupAgent`).** Files: `/brief.md`, `/questions.md`, `/members.md` (names and roles, never phones), `/answers/round-N/<userId|anon-responseId>/<questionId>.md`, `/report.md`, `/memory.md`, `/rounds/N-proposal.json`, `/exports/<timestamp>.md` (one per export run). `/brief.md` carries the composed brief plus a "What should come back to the group" line from `surveys.output_shape` (`shapeReport()`), and the digest prompt tells the agent to give the report that shape. `syncFromD1()` rebuilds the first three and imports transcribed answers idempotently, so the DO can always be rebuilt from D1. `ingestResponse()` files answers and schedules a debounced `runDigest()` (3 min, idempotent); a cron at 03:00 UTC runs `runNightly()` (digest if the debounce missed anything, close overdue rounds). `runDigest()` gives the model `list_files` / `read_file` / `read_files` / `search_files` / `write_file` (writes restricted to `/report.md`, `/memory.md`, `/notes/*`), then mirrors `/report.md` into `surveys.report_md` + `report_updated_at` so members read it from D1. `proposeRound()` asks for JSON (`{kind, rationale, asks: [{text, hint, target}]}`), validates probe targets against members who answered, and writes the `rounds` row. Both notify owner/admins via the Inbox (`services/notify.ts`). **Exports:** `addConnection()` wraps `this.addMcpServer(name, url, {id, callbackHost, callbackPath: "/api/mcp/callback/<surveyId>"})`; `runExport()` gives the model the read-only file tools plus `this.mcp.getAITools({state: "ready"})`, the report and the answers CSV, and counts a run as `ok` only if a destination tool was actually called; `runAutoExport()` is scheduled after a digest when `state.autoExport` is on. `onStart()` sets `this.mcp.configureOAuthCallback({customHandler})` to redirect the owner back to `/d/<dashboardCode>?tab=agent` (`state.dashboardCode` is synced from D1). Every model call is tracked as a PostHog `$ai_generation` with `$ai_provider`.

**Frontend.** Participant: `GroupReportScreen` (stage `report`) shows the report (locked until they answer), the open-group feed, and the way into the next round; `WelcomeScreen` shows round number, "welcome back", probe copy and the visibility line; `ThankYouScreen` gets "See what the group said". `ParticipantPage` snapshots the asks being answered in `flowQuestionsRef` because the personalised survey refetches with those asks gone after submit. Creator: `AgentDashboard` has Responses / Members (role actions per the rules above) / Agent tabs; `AgentPanel` polls `GET …/agent` every 6 s and holds the report, proposed-round approval, the open-group switch, the **Exports** card (connections with state dots, add-destination form, "Export now", "Export after every report" switch, CSV download; reads `?connection=` on return from OAuth) and the agent's notes. `AgentReadyScreen`'s switch persists via `PUT …/settings`. `CreatorHome` is a chat-style inbox: one list for every role (no "Parlos you're in" section), rows that need the viewer pinned on top (a proposed round → "Approve" pill, opens `/d/:code?tab=agent`; a pending probe for a member → "Answer" pill, opens the personal link), then newest activity, drafts last. Each row: a 44 px avatar cluster of up to three other members (`faces`, initials fallback, title initial when alone), a two-line title with an admin/member chip, a chat-style time top-right (`now`, `5m`, `2h`, `Yesterday`, weekday, `9 Oct`), and a one-line preview of what last happened ("Agent proposed round 2", "3 new answers · report updated", "Agent: <first line of the report>", "Round 2 · 4 of 7 answered", "Share the link to get the first answers"). The rules are pure functions in `lib/parloRow.ts` (`describeParlo`, `sortParlos`, `formatListTime`, `initialsFor`); the header has no response-count stat on purpose (vanity metric). Test ids: `parlo-row` with `data-action="approve|answer"` and `data-unread`. Opening a dashboard calls `POST /api/my/surveys/:id/read`, which is what clears the dot and `newCount`. The tab bar is Home · + · Inbox · Profile: the Reels listening player (`components/creator/player/`, `hooks/useFeedBuffer.ts`, the `/api/my/feed` client) was removed on 2026-10-11, and the app no longer jumps to it on launch when there are unread answers. The backend `/api/my/feed` and per-response read routes still exist but nothing calls them.

**North-star metric.** Measure the loop, not the survey: report delivered → answered the next round → started their own parlo. Events: `group_report_viewed`, `participant_joined_group`, `agent_digest_completed`, `agent_round_proposed`, `round_approved`, `consent_accepted {round, visibility}`.

## Question types

Surveys support three question types per question:
- **`voice`** (default): participant records audio. Stored in R2 as `responses/{responseId}/{questionId}.webm`. Whisper transcribes it in the background.
- **`photo`**: participant taps a button, native camera opens, they take a picture. Compressed client-side via `browser-image-compression` (1080px max, ~1MB JPEG, 0.85 quality — high enough for Instagram). Stored as `responses/{responseId}/{questionId}.jpg`.
- **`video`**: participant taps a button, native camera opens in video mode, they record up to 60 seconds. **Hard caps**: 60s duration, 25MB file size, must be vertical (we reject landscape post-capture). No client compression — phones' hardware H.264 encoder produces ~10MB for 60s @ 1080p which is fine. Stored as `responses/{responseId}/{questionId}.mp4`.

The AI picks the type per question based on the gather goal. The Llama prompt teaches it to use `photo` for static visual evidence and `video` for dynamic/temporal evidence (process, motion, demos). Default is voice.

**DB convention** (because of an existing `audio_r2_key NOT NULL` constraint we don't want to migrate):
- Photo answers store `""` in `audio_r2_key` and the real R2 key in `image_r2_key`. `transcription_status = 'completed'` (skip transcription).
- Video answers store `""` in `audio_r2_key` and the real R2 key in `video_r2_key`. `transcription_status = 'pending'` — Whisper transcribes the audio track from the raw video file (it accepts the bytes and ignores video frames).
- Code paths must check `video_r2_key` then `image_r2_key` then `audio_r2_key` when rendering an answer.

**Video file extension caveat**: iOS Safari returns `.mov` (QuickTime) but we always upload to a `.mp4` presigned URL. R2 stores the bytes as-is — the filename extension is just a label. Modern browsers play `.mov` content from a `.mp4` URL fine because they detect the codec from the bytes. No transcoding required (and Workers can't transcode anyway).

The participant frontend renders `PhotoQuestionScreen` for photo questions, `VideoQuestionScreen` for video questions, and `QuestionScreen` for voice questions. ParticipantPage branches on `question.type`.

`ReviewScreen` and `ThankYouScreen` also detect the answer media type — they inspect `answer.blob?.type` MIME and branch: `image/*` → inline `<img>` preview, `video/*` → inline `<video controls playsInline>` player, `audio/*` → audio progress bar + autoplay, `textContent` set → text card. Don't add a question-type prop to the answer rows — the MIME-from-blob approach keeps the answer shape generic and avoids threading state through.

The dashboard renders `<video controls playsInline>` for answers with `videoUrl`, `<img>` for `imageUrl`, and an audio player for `audioUrl`. There's a "Download" link on photo and video answers — the Instagram-share styled card export is a future v2 feature.

The upload helper at `frontend/src/api/upload.ts` uses `XMLHttpRequest` (not `fetch`) so we can expose `onProgress` callbacks — important for video uploads which are ~10MB+. Voice and photo callers ignore the progress callback.

## Media-mix copy adaptation

Voice-only surveys and mixed-media surveys need different onboarding copy. Instead of peppering components with `if (hasVideo) ...` checks, the single source of truth lives in `frontend/src/lib/mediaMix.ts` — `getMediaMix(questions)` inspects `question.type` across the survey and returns:

- `hasVoice` / `hasPhoto` / `hasVideo` / `isVoiceOnly` / `isMixed` booleans
- `label` — short badge text for the welcome meta row ("Voice only", "Voice & photo", "Voice, photo & video", etc.)
- `welcomeDescription` — full sentence under the welcome title
- `consentDescription` — full sentence on the consent screen
- `ctaLabel` — "Start recording" for voice-only, "Let's start" otherwise
- `securityFootnote` — small print under welcome CTA

Used in: `useGetSurvey` (api/client.ts) for `survey.description` + `survey.ctaLabel`; `WelcomeScreen.tsx` for the badge icon+label and the footnote; `ParticipantPage.tsx` for the consent description and button label. Whenever you add new onboarding copy that differs by media type, extend `MediaMix` rather than branching inline.

## Share URLs

Survey share URLs use a GitHub-style `slug-code` pattern: `parlo.me/s/{slug}-{code}`, e.g. `parlo.me/s/lemonade-pirates-2rbee8p6`.

- The **slug** is a slugified version of the survey title (decorative, not stored in DB, regenerated each time a share URL is built).
- The **code** is the canonical 6-12 char alphanumeric identifier — the trailing segment of the URL.
- Backend extracts the code from possibly-slugged params via `extractCode()` (see `backend/src/services/slug.ts`). Frontend has a parallel helper at `frontend/src/lib/slug.ts`.
- Bare-code URLs like `parlo.me/s/2rbee8p6` still work — the regex matches them too.
- Title changes don't break old shared URLs (the code stays the same).

When generating share URLs in the frontend, always use `buildShareUrl(title, code)` from `@/lib/slug`. Never hardcode `parlo.me/s/${code}`.

When parsing the URL param in `ParticipantPage` or any backend route, always call `extractCode()` first.

## Open Graph previews

Survey share URLs (`/s/*`) get dynamic OG meta tags via a Cloudflare Pages Function at `frontend/functions/s/[code].ts`. The function uses `HTMLRewriter` to inject `<meta og:*>` and `<meta twitter:*>` tags into `index.html` for everyone (no user-agent sniffing). React hydrates fine because the meta tags live in `<head>`, not the SPA mount point.

Pages Functions are scoped to `/s/*` and `/api/*` via `frontend/public/_routes.json` — without this, Pages would invoke the Function on every request.

OG images are generated dynamically by the backend Worker at `GET /api/og/:code.png` using `workers-og` (Satori port). Each survey gets a unique deterministic texture variant on the Parlo1 black canvas; the palette constants in `backend/src/routes/og.ts` mirror the dark-mode tokens in `gui/themes/parlo1.md` (the Worker has no CSS variables).

## WhatsApp (Kapso)

- Bot number: **+1 201-578-9837**, phone number ID `1407538595771805`, WABA `1134962085529075`. Frontend wa.me links come from `frontend/src/lib/whatsapp.ts` (`buildBotChatUrl`) — never hardcode the number.
- Kapso webhook (phone-number scope, `kind: kapso`, payload v2, event `whatsapp.message.received`) points at `https://api.parlo.me/api/webhooks/whatsapp`.
- Worker secrets: `KAPSO_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET` (synced from GitHub secrets on deploy).
- Templates (en_US, UTILITY, **NAMED** params — send body params with `parameter_name`; URL button params stay positional):
  - `parlo_survey_ready` — `{{share_url}}`; button → `parlo.me/s/{code}`
  - `parlo_thanks` — `{{name}}`
  - `parlo_thanks_open` — `{{name}}`; button → `parlo.me/r/{surveyCode}`
  - `parlo_new_response` — `{{respondent}}`, `{{survey_title}}`, `{{response_count}}`; button → `parlo.me/d/{dashboardCode}`
  - `parlo_report_ready` — submitted 2026-10-26 through `.github/workflows/whatsapp-template.yml` (payload `backend/whatsapp-templates/parlo_report_ready.json`; the workflow uses the CI-held `KAPSO_API_KEY`, there is no key on the laptop). Body "The report for {{survey_title}} is ready: what the group said, in the agent's words. Tap below to read it.", button "Read the report" → `https://parlo.me/s/{{1}}` with suffix `{code}?t={memberToken}`. Sent by `services/reportReady.ts` (`notifyReportReady`, called by `GroupAgent.runDigest` after the report is mirrored) to every active `member` with a phone who has answered, once per round (KV `report-notified:{surveyId}:{userId}:{round}`, 30 days). Sends fail quietly until Meta approves it.
  - `parlo_new_round` — created in Kapso 2026-10-10, **submitted for Meta review** (sends fail until it is approved; check the Templates page in Kapso). Body: "Round {{round_number}} of {{survey_title}} is open. The agent has a question for you. Tap below to answer by voice. It takes about a minute." Button "Answer now" → `https://parlo.me/s/{{1}}` with suffix `{code}?t={memberToken}`. Sent on round approval by `routes/groups.ts`.
- Templates live on the WABA: switching numbers/WABAs means recreating them.
- Free-form `sendText` only reaches users who messaged us in the last 24h. The WhatsApp OTP fallback still uses `sendText`, so it fails for first-time users. Meta refuses AUTHENTICATION templates until the business is verified; once it is, create a `COPY_CODE` auth template and switch `routes/otp.ts` to it.

## Key Naming Conventions

The two creator setup questions use these keys consistently:
- **audience** — "Who will I be talking to?" (question index 0)
- **gather** — "What info do you need me to gather?" (question index 1)

These keys are used in: R2 paths (`surveys/{id}/audience.webm`), upload URL keys, textAnswers fields, AI prompt placeholders (`{{audience}}`, `{{gather}}`), and QUESTION_INDEX_TO_KEY mapping.

## Deploy Commands

```bash
# Frontend
cd frontend && npx vite build && wrangler pages deploy dist --project-name parlo

# Backend (must use global wrangler with --name flag). Apply D1 migrations first;
# the Worker that ships with a migration expects its schema.
/Users/andrejzg/.npm-global/bin/wrangler d1 migrations apply parlo --remote --config /Users/andrejzg/work/repos/parlo/backend/wrangler.toml
/Users/andrejzg/.npm-global/bin/wrangler deploy --name parlo-backend --config /Users/andrejzg/work/repos/parlo/backend/wrangler.toml
```

CI (`deploy.yml`) does the same: sync secrets → apply migrations → deploy → verify bindings (now including `GROUP_AGENT`). Its jobs run on Node 22: wrangler 4 refuses Node 20, and from 2026-10-11 to 2026-10-25 every push to `main` failed the backend job at "Sync Worker secrets" with "Wrangler requires at least Node.js v22.0.0" while the frontend and MCP jobs still passed, so the backend was only ever deployed by hand in that window. If the backend job fails again, read the first line of that step before anything else. Since the Node 22 fix the job gets further and, on every push to `main` on 2026-10-25, fails at "Apply D1 migrations" with `code: 7403, The given account is not valid or is not authorized to access this service` on the D1 query API: the `CLOUDFLARE_API_TOKEN` GitHub secret can deploy Workers and Pages but cannot query D1 (it needs D1 Edit on the account, or it is scoped to a different account). Until that token is reissued, the backend ships by hand with the two commands above (migrations apply cleanly locally); the frontend and MCP jobs still deploy from CI.

WARNING: Running `wrangler deploy` from the backend directory without `--name parlo-backend` may deploy to the wrong worker name. Always use the full command above.

## Design Conventions

- **The thing a creator makes is a "parlo"** in all user-facing copy — "Create a parlo", "Your parlos", "Untitled parlo", "Share this parlo", the WhatsApp bot's replies. Never "survey" on screen. Code identifiers, routes, tables, analytics event names and the API stay `survey`. The landing headline is "Group chats, run by an agent." with the subline "Your agent gathers everyone's answers, follows up, and reports back." (changed 2026-10-10 for the agent-moderated group pivot). The Open Graph fallbacks followed on 2026-10-26: the `/s/*` card is "<title> — a parlo" (`frontend/functions/s/[code].ts`) and the image's fallback title is "A parlo" (`backend/src/routes/og.ts`); the April "Voice Survey" copy is gone everywhere.
- Mobile-first, dark theme default
- Stage-based state machine pattern (Index/Page.tsx orchestrates flows)
- TypeForm-inspired animations with Framer Motion
- **Parlo1 design language** (Graphical theme, adopted 2026-10-10). Source of truth: `GUI.md` + `gui/themes/parlo1.md` (values) + `gui/themes/parlo1-components.md` (per-component assignments). Runtime tokens are CSS variables in `frontend/src/index.css`; `frontend/tailwind.config.ts` replaces Tailwind's default palette/type/radius/shadow scales with theme vocabulary, so only theme utilities exist:
  - Colours: `neutral-1…10` (+`-transparent`), `color-1…4` (+`-transparent`), `success` / `warning` / `error` (+`-transparent`), plus the shadcn roles `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, and `badge` / `nav-active` for the accent-on-fill roles. `primary` is **neutral-10** (white in dark, black in light) — the theme's primary action colour; the red-orange accent `color-1` (#dd4222) is for indicators, waveforms, progress, active nav and focus, never for button fills. Text on an accent fill is black (`text-badge-foreground`). `linkedin` is a documented third-party brand exception.
  - Type: one family, Open Runde (`public/fonts/open-runde/`, OFL), via font roles `font-ui` / `font-brand` / `font-editorial` / `font-data`; steps `text-xxs … text-xxl` carry line height + tracking (never add `leading-*`); weights `font-regular` (400) / `font-medium` (700) / `font-heavy` (900 → falls back to Bold, the family has no Black face); tracking `tracking-xs…xl`. Roles: screen titles `font-brand text-l sm:text-xl font-heavy`; big question headings `font-editorial text-l sm:text-xl font-medium`; uppercase labels `font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground`; numbers/timers `font-data tabular-nums`.
  - Spacing: `xxs 4 · xs 8 · s 12 · m 16 · l 24 · xl 32 · xxl 48` as `p-m`, `gap-s`, `px-l`… (numeric classes remain for widths/heights/offsets only). Radii `rounded-xs 8 · s 16 · m 23 · l 29 · xl 42 · full`; buttons are pills, inputs `rounded-s`, cards `rounded-m`.
  - Surfaces: no native borders anywhere (border width tokens are 0). Flat fills: canvas `bg-background`, cards `bg-card` (neutral-2), inputs/chips `bg-muted` (neutral-3). A needed edge is an inset shadow: `shadow-edge`, `shadow-edge-t/b/l/r`, `shadow-edge-accent`. Elevation only on popups/toasts: `shadow-m`.
  - Motion: `--motion-duration` 160 ms / `--motion-large-duration` 280 ms / easing `cubic-bezier(.16,1,.3,1)`, press = 1 px (`active:translate-y-press`), popup scale 0.96. Framer values live in `frontend/src/lib/animations.ts` (`transitionSmall`, `transitionLarge`, `press`, `fadeUp`, `stagger`, `pageVariants`). `transition-colors` already uses the theme duration/easing; `duration-large ease-large` for large surfaces.
  - Icons: `lucide-react` (outline; the theme's "filled" style is a known gap). Decorative icons get `aria-hidden`; colour via `currentColor`.
  - Modes: both light and dark tokens are defined; the app's established mode is dark, set by `class="dark"` on `<html>` in `index.html`. Sonner reads that class.
  - Shared components (`frontend/src/components/ui/`): `Button` (variants default/secondary/outline/ghost/destructive/link; sizes default 44 px, `sm`, `lg` 56 px for the main bottom CTA, `icon`), `Input`, `Textarea`, `Label`, `Select`, `Switch`, `Toast`/`Sonner`, `Tooltip`. Prefer them over hand-styled buttons/inputs.
  - Gaps vs. the reference, resolved locally: `controlSize` names (checkbox/switch/track) map to the same-named spacing tokens; Open Runde has no 900 weight; Lucide has no filled set.
- Voice-first with "Type instead" escape hatch (auto-switches on mic denial)
- `pb-safe` utility class for safe-area-inset-bottom on all screens with bottom CTAs
- `h-svh` uses `100dvh` (dynamic viewport height) for mobile browser chrome handling
- Landscape mode blocked with rotation overlay (LandscapeOverlay.tsx)
- `user-select: none` on all buttons/links to prevent accidental text selection on mobile
- Waveform heartbeat: 1-second pulse during silence to show recording is active

## Prompts

AI prompts are editable at runtime via:
- Admin UI: parlo.me/admin
- Cloudflare KV dashboard: Storage & databases → KV → SESSIONS
- KV keys (defaults live in `backend/src/services/ai.ts` as `PROMPT_DEFAULTS`; `routes/admin.ts` imports them, so never duplicate prompt text):
  - `prompt:system` — system prompt for question generation
  - `prompt:user` — legacy generation (`{{audience}}`, `{{gather}}`)
  - `prompt:brief` — brief-flow generation (`{{brief}}`, `{{clarifications}}`)
  - `prompt:clarify` — next clarifying question (`{{brief}}`, `{{clarifications}}`, `{{count}}`); must return `{"question","hint"}`
- The brief-checklist rubric (TypeSafe Noul questions) is code, not KV: `backend/src/services/brief.ts`.
- Versioned: each save creates immutable version, tracked in PostHog $ai_generation events (`$ai_prompt_version_*` properties). TypeSafe calls are tracked as `$ai_provider: "typesafe"`.

## Transcription

Audio responses are automatically transcribed using Workers AI Whisper when a participant submits.
- Triggered via `c.executionCtx.waitUntil()` so it doesn't block the submit response.
- Service: `backend/src/services/transcription.ts` — `transcribeResponseAnswers(env, responseId)`
- Processes answers sequentially to avoid Workers AI rate limits.
- `transcription_status` values: `pending` → `completed` or `failed`
- Migration: `0003_transcriptions.sql` adds `transcription` and `transcription_status` columns to `response_answers`.

## Silence trimming

`frontend/src/lib/audioTrim.ts` — `finalizeRecording(rec, context)` runs on every voice recording the moment the mic stops: participant answers (single take and the multi-segment merge, in `QuestionScreen`), the creator's intro (`IntroScreen`, before they hear it back) and the archived brief (`CreatorPage.handleBriefContinue`). Cheap and fully client-side:

- Decode via `OfflineAudioContext` (gives a mono 16 kHz mix for free), 20 ms frames, RMS in dBFS. Gate = `max(loud − 30 dB, quiet + 6 dB)` where loud/quiet are the 90th/10th percentile frames, clamped to [−55, −30] dBFS; a frame is voice only with a voiced neighbour (a 20 ms click can't end the leading silence).
- Leading silence cut leaving a 120 ms pad, trailing leaving 250 ms. Internal pauses ≥ 1 s shortened to 350 ms (room tone from both sides is what's kept). 5 ms fades at every cut.
- Output is 16-bit mono 16 kHz WAV (`audio/wav`). Only when it saves ≥ 200 ms — otherwise the original compressed blob is kept, since a WAV is ~15× an Opus blob (≈32 KB/s). Anything that can't be decoded (Playwright's fake recorder) falls back to the untouched recording; nothing in the flow blocks on this.
- WAV bytes under the `.webm` upload key is already how multi-segment answers work; the backend takes the content-type from the request and Whisper/the players read the bytes. `durationMs` on the answer/intro is the trimmed length. PostHog event `audio_trimmed` {context, changed, inputMs, outputMs, removedMs, inputBytes, outputBytes}.
- `planTrim(pcm, sampleRate)` and `encodeWav` are pure exports — the scratch harness that validated them drives the TS module through the Vite dev server in headless Chromium (synthetic PCM with known pauses + a real MediaRecorder Opus take).

## Participant Flow

```
welcome → consent → question (×N) → review → phone → OTP → submit → done
                                      (skip phone+OTP if returning device)
```

Key features in the participant flow:
- **Multi-segment recording**: Participants can add multiple voice clips per question ("Add more" button). Segments are merged into a single WAV blob via `audioMerge.ts` when moving to the next question.
- **Review screen**: After all questions, participants see an accordion card with playback + "Redo this answer" for each question before proceeding to PII collection.
- **Redo from ThankYouScreen**: Post-submission, participants can tap answers to play back and redo individual questions.
- **Session persistence**: All state (stage, answers, blobs, PII) is persisted to IndexedDB on every state change. On page refresh, the session is restored automatically.
- **Background uploads**: After consent, a response session is started early to get presigned URLs. Each answer is uploaded in the background via `uploadQueue.ts` immediately after recording. At submit time, only answers still in `pending`/`failed` status are retried with fresh tokens.
- **Upload token lifecycle**: Tokens are one-time-use. The submit flow always calls `refresh-urls` before retrying failed uploads to avoid using consumed tokens.
- **Phone auth with OTP**: After review, participants enter their phone number. Firebase sends an SMS OTP; if SMS doesn't arrive, WhatsApp OTP fallback is available. `OtpScreen` hands back a `PhoneProof`; `handleOtpVerified` trades it for an API key via `POST /api/auth/login` and stores both in the device record. Submit sends that key, so the member is identified by proof, never by the typed phone.
- **Device recognition**: The device record (`localStorage parlo-device-auth`, 30-day TTL) holds `{phone, apiKey}`. Returning participants with a key skip phone+OTP; a record without a key (verified before 2026-10-11) is cleared and they verify once more.

## Offline Resilience

- **IndexedDB** (`lib/sessionStore.ts`): Two object stores — `sessions` (keyed by surveyCode) and `answers` (keyed by surveyCode:questionId). Audio blobs stored directly.
- **Upload queue** (`lib/uploadQueue.ts`): Singleton with online/offline detection, exponential backoff retry (max 5 attempts), per-question cancellation for re-recordings.
- **Session restore**: On page load, checks IndexedDB for in-progress session matching the survey. If found, restores all state and shows "Session restored" toast.
- **Stale cleanup**: Sessions older than 24h are cleaned up on next visit.
- **Upload URL expiry**: Presigned URLs have 10-min server TTL. Frontend tracks `uploadUrlsCreatedAt` and refreshes via `POST /api/responses/:id/refresh-urls` when URLs are >8 min old.

## E2E Tests

```bash
# Run from frontend directory
cd frontend && npx playwright test --project=chromium
```

Test fixtures in `e2e/fixtures/`:
- `mock-audio.ts` — Injects fake MediaRecorder, getUserMedia, AudioContext via `page.addInitScript()`. Supports `denyPermission` option.
- `mock-api.ts` — Intercepts all API routes via `page.route()`. Exports `TEST_SURVEY` and `TEST_RESPONSE` constants. Supports `surveyCode`, `failUpload`, `failGenerate` options.

Current specs:
- `e2e/participant/happy-path.spec.ts` — functional flow tests (voice recording, mic-denial text mode, session restore). **Note**: this file's `fillPIIAndSubmit` helper references first/last-name screens that no longer exist in the current flow — consider stale until refactored.
- `e2e/device-audit.spec.ts` — visual audit across **iPhone SE / Pixel 7 / iPhone 15 Pro Max**. Two passes per device: (1) voice-only happy path captures welcome → consent → voice Q → review → phone, (2) two mini mixed-type surveys capture the welcome/consent/capture screens for photo and video. 33 screenshots total dropped in `/tmp/parlo-<device>/`. ~60s runtime. **Known failure (as of 2026-10-10):** pass 3 times out waiting for "All done!" because the participant flow now has a LinkedIn-connect stage after review that the spec predates — `08-stuck.png` shows it. Passes 1–2 still produce every welcome/consent/capture screenshot, so the run is still useful; just don't trust the exit code. Use this whenever you touch participant-facing UI — grep for layout regressions across small / medium / large viewports in one shot.
- Both specs were re-run on 2026-10-10 after the groups pivot: brief-flow passes on all three devices; device-audit still fails only at the known "All done!" step above. The mock `GET /api/s/:code` fixture predates `visibility` / `round` / `member` / `report`, which the frontend defaults when missing.
- `e2e/creator/create-flow.spec.ts` — the opener-only creator flow (2026-10-25) with `/surveys`, `/transcribe` (a canned transcript), `/generate`, the intro upload and save, claim, settings, the home list and the LinkedIn profile stubbed: on three devices, landing → the opener (no shape cards, no skip) → record, stop, use → phone, asserting the take went to Whisper and to R2 and that nothing was built yet. A fourth test on iPhone SE runs as a verified device (`localStorage parlo-device-auth`): opener → "Building your agent…" last → "Your agent is ready.", asserting the `/generate` body is `{brief: <the canned transcript>}` with no shape. Screenshots in `$PARLO_SHOTS_DIR/parlo-creator-<device>/` (`/tmp` by default). Playwright's Chromium has no speech engine, so the real Whisper path is tested on a phone.
- `e2e/creator/home.spec.ts` — the logged-in home on the same three devices: `localStorage parlo-device-auth` + `/api/my/surveys` and `/api/auth/linkedin/profile` stubbed, member photos served as SVG. Asserts the order (pinned approve → pinned answer → recency → draft), pills, chips, time labels, and that tapping a pending approval lands on `/d/:code?tab=agent`. Screenshots in `$PARLO_SHOTS_DIR/parlo-home-<device>/`.

**Important**: Playwright specs need a running preview server, NOT the Vite dev server — `npm run dev` doesn't load `.env.production`, so Firebase init throws `auth/invalid-api-key` and the React app never mounts (blank white page in screenshots). Start a preview server first:

```bash
npx vite build && npx vite preview --port 5173 --host 127.0.0.1 &
# then run playwright
npx playwright test e2e/device-audit.spec.ts --project=chromium --reporter=list
```

The `playwright.config.ts` `webServer` hook is set to `npm run dev`, which is correct for tests that mock Firebase entirely, but for device-audit (which hits the real app bootstrap) you must use preview.

For the Claude desktop app's browser pane, a local (gitignored) `.claude/launch.json` can hold a `frontend-preview` configuration: `runtimeExecutable: "sh"`, `runtimeArgs: ["-c", "cd frontend && npx vite preview --port 5173 --host 127.0.0.1"]`, `port: 5173`. Build first — it serves `dist/`.

## Common Pitfalls

1. **API response shapes**: Backend returns DB row shapes (snake_case, extra fields). Frontend must map to its own types. Always check the actual route handler.
2. **Empty body parsing**: Hono's `c.req.json()` throws on empty body. Use `.catch(() => ({}))` for optional bodies.
3. **Backend deploy**: Must use `--name parlo-backend` flag or it deploys to wrong worker.
4. **KV list eventual consistency**: `kv.list()` may not find recently written keys. Check known keys directly.
5. **Rate limiting**: Survey creation is rate-limited (100/hr per IP). Can hit this during development.
6. **Upload tokens are one-time-use**: Once consumed by `validateUploadToken`, the token is deleted from KV. Never retry an upload with a potentially consumed token — always call `refresh-urls` first.
7. **CORS**: Backend allows `parlo.me`, `localhost:5173`/`localhost:4173` and, since 2026-10-25, any Cloudflare Pages preview `https://<branch-or-hash>.parlo-d04.pages.dev` (so a feature-branch deploy works on a phone; before that "Create a parlo" toasted "Something went wrong" on previews). If adding a new frontend domain, update the CORS config in `backend/src/index.ts`.
8. **AnimatePresence overlaps**: During page transitions, both entering and exiting screens render simultaneously (`mode="sync"`). Use `.first()` in Playwright tests when locating elements that exist on both screens (e.g., "Next" button, timer badge).
9. **Playwright tests must run from `frontend/` directory**: The config is at `frontend/playwright.config.ts`. Running from repo root will fail with "project not found".
10. **Blob URL lifecycle**: If a component creates an object URL with `URL.createObjectURL(blob)` and passes it up to a parent (e.g. `PhotoQuestionScreen` → `ParticipantPage`), do NOT revoke that URL on unmount. The parent will use it downstream (Review, Thank You), and an unmount-time revoke kills those previews — the `<img>` then renders broken with alt-text fallback, which looks exactly like a text card. Only revoke when replacing the URL with a new one inline (e.g. on retake). The browser will GC the URL when the underlying blob is no longer referenced.
11. **Flex scroll containers need `min-h-0`**: Any `flex-1 overflow-y-auto` child of a `flex-col` parent must also have `min-h-0`, otherwise the flex item keeps its default `min-height: auto` (= content size) and refuses to shrink, so `overflow-y-auto` never activates. Content overflows past the viewport and gets clipped behind the bottom CTA. Affects `ReviewScreen`, `ThankYouScreen`, `QuestionScreen`, `PhotoQuestionScreen`, `VideoQuestionScreen` — all of them have `min-h-0` applied; don't remove it.
12. **Playwright device audit needs `vite preview`, not `vite dev`**: See E2E Tests section. Dev server runs without `.env.production`, so Firebase throws and the app never renders. Always run `vite preview` after `vite build` for audit runs.
13. **Welcome/Consent copy adapts to media mix**: Don't hardcode "voice responses" / "Start recording" strings — use `getMediaMix()` from `lib/mediaMix.ts`. See the "Media-mix copy adaptation" section above.
14. **Secret sync must run before `wrangler deploy` in CI**: `wrangler secret bulk` PATCHes Worker settings and re-sends the non-secret bindings it reads back. On 2026-10-09 that read raced the deploy that had just finished and the PATCH wiped D1/R2/KV/AI, so every request 500'd with `Cannot read properties of undefined (reading 'get')`. `deploy.yml` now syncs secrets first, deploys last (bindings from `wrangler.toml` always win, secrets are kept), and a "Verify Worker bindings" step fails the job if DB/AUDIO_BUCKET/KV/AI are missing. If you ever see that error in prod, re-run the backend deploy command — it restores the bindings.
15. **Web Speech API isn't everywhere**: `useLiveTranscript` falls back to Whisper (`/transcribe`) when `SpeechRecognition` is missing, errors with `network`/`not-allowed`/etc., or the watchdog hears voice for 2.5 s with no words after 8 s. Chrome restarts recognition every ~60 s (handled in `onend`); Safari and Chrome disagree on `resultIndex`, so results are always rebuilt from the full `results` list. Firefox and Playwright's Chromium always use the fallback.
16. **D1 migration tracker was out of sync**: 0009 and 0010 were applied by hand without being recorded, so `wrangler d1 migrations apply parlo --remote` failed on 0009 with "duplicate column". Fixed on 2026-10-10 by backfilling `d1_migrations` rows for 0009–0011; `migrations apply` is clean again. If a future apply fails with a duplicate column, check `SELECT name FROM d1_migrations` against `PRAGMA table_info(...)` before re-running anything.
17. **Brief checklist ids**: `backend/src/services/brief.ts` (TypeSafe rubric) is the only copy since 2026-10-25; the frontend checklist (`lib/briefChecklist.ts`, `BriefScreen`) went with the free brief. `/brief/evaluate` stays for the API.
18. **`wrangler pages deploy` ships the current git branch**: Pages production (`parlo.me`) is the `main` branch deployment. Running the documented frontend deploy command from a feature branch creates a *preview* deployment at `https://<branch>.parlo-d04.pages.dev` and leaves production untouched. To ship a feature branch to production deliberately, add `--branch main`. The backend command has no branch concept — it always deploys `api.parlo.me`.
19. **Pages answers unknown paths with 200 HTML (SPA fallback)**: anything that fetches a static asset from `parlo.me` (e.g. the OG route loading `fonts/open-runde/OpenRunde-Bold.woff`) must validate the bytes, not just `res.ok` — on 2026-10-10 the Worker cached that HTML as "font data" and the OG endpoint streamed empty 200 PNGs until fixed. `routes/og.ts` now checks the WOFF magic, renders the PNG into memory before responding, and returns `no-store` on failure.
20. **`wrangler dev` reports the custom domain as the request origin**: with `routes = [{pattern = "api.parlo.me", custom_domain = true}]`, `new URL(c.req.url).origin` inside local dev is `http://api.parlo.me`, so presigned upload/read URLs minted locally point at production. Rewrite the host to `http://127.0.0.1:8787` in local scripts (see the smoke test pattern) — it is correct in production.
21. **Workers AI Llama narrates tool calls**: through `workers-ai-provider` the Llama fallback sometimes returns `{"name":"write_file","parameters":{…}}` as plain text instead of calling the tool. `GroupAgent.runDigest()` salvages those (`salvageWriteCalls`) and otherwise treats non-JSON final text as the report. Cerebras and Claude call tools properly.
22. **A phone number in a request is never identity.** Until 2026-10-11 `POST /api/auth/login` and `/claim` handed out API keys for any phone with no proof, and `/submit` joined anyone as the owner of the phone they typed (and returned that member's token). All three now require a proof (API key, Firebase ID token or WhatsApp proof token — see "Phone proof"), and the LinkedIn routes take the API key instead of `?phone=`. Never add a route that trusts `body.phone`; call `resolveVerifiedPhone()` from `services/phoneProof.ts`.
23. **Legacy identity tables**: `participants` and `survey_participants` still exist but nothing writes to them since 0012. `survey_audio` was never written. Drop them in a later migration once the pivot has settled.
24. **Two visibility states only**: don't add per-audience policies, tags or an anonymous-visible mode without re-reading the decision in memory. Consent copy must come from `lib/visibility.ts`.
25. **Timestamps come in two formats**: columns filled by SQLite defaults (`datetime('now')`: `created_at`, `submitted_at`, `rounds.sent_at`…) are `YYYY-MM-DD HH:MM:SS` in UTC with no zone, while the Worker writes ISO strings (`report_updated_at`…). Browsers parse the former as *local* time and plain string comparison across the two is wrong within a day. Normalise with `toIso()` / `latestOf()` from `services/home.ts` before returning or comparing them.
26. **Phones are E.164 via `libphonenumber-js`** (`services/phone.ts`, `libphonenumber-js/min` on both sides). Until 2026-10-11 `normalizePhone()` was a regex that stripped every zero after the country code, which eats legitimate ones (`+39 06…` Italian landlines, `+386 40…` Slovenian mobiles) and collapsed test numbers like `+1555000 0001` to `+15551`. Now `normalizePhone()` parses and returns `.number`; trunk zeros go (`+44 (0)7700…`), real ones stay. `findUserByPhone()` in `services/groups.ts` also tries `legacyNormalizePhone()` of the canonical number and rewrites a row it finds that way, so people stored in the mangled form keep their account on the next login. The frontend `PhoneScreen` builds the number with `toE164(countryCode, local, iso)` for the same reason — never strip zeros by hand again. Production rows were canonicalised by hand on 2026-10-11 (one duplicate user merged).
27. **Firebase ID tokens are verified without the Admin SDK**: `verifyFirebaseIdTokenWithKeys()` is a pure function (JWKS in, claims out) so it can be tested with a generated key pair; the scratch harness used on 2026-10-11 covered signature, `aud`, `iss`, `exp`, `iat`, unknown `kid`, `alg: none` and tampering. Google rotates keys daily: an unknown `kid` refetches the JWKS once before failing.
28. **Shape vocabulary** (since 2026-10-25 backend only: `frontend/src/lib/shapes.ts` went with the shape and sentence screens): `backend/src/services/shapes.ts` holds the ids, the composed brief, report lines for the agent, the timing rows and the retired ids. The frontend sends `/generate` a plain `{brief}`; API callers may still send `shape | audience | length | timing | outputs`, which the backend validates (unknown shape → 400, unknown audience/length/timing → defaults).
29. **Output vocabulary** (since 2026-10-25 backend only: `frontend/src/lib/outputs.ts`, `OutputsScreen`, `BrandIcons` and `useFitLines` went with the outputs screen): `backend/src/services/outputs.ts` holds the ids, the brief lines that shape the asks, the agent's "Also make" section and `LEGACY_OUTPUTS` for the 2026-10-15 channel ids. The backend maps legacy ids to their content type and drops unknown ids silently.
30. **(Historical since 2026-10-25, the review screen and `useDragAutoScroll` are gone; kept for the next drag list.) Framer Motion drag knows nothing about a scrolling container**: the drag offset is the raw pointer delta, so a list that scrolls under a held finger makes the card drift and `Reorder` compare the wrong boxes. `hooks/useDragAutoScroll.ts` scrolls the review list near its edges and, while a drag is on, intercepts `pointermove` on `window` (capture) and re-dispatches it with `clientY` shifted by the distance scrolled, so Framer only ever sees consistent viewport coordinates. Do **not** add `layoutScroll` to that container: Framer caches a `layoutScroll` ancestor's offset between layout updates and a continuously scrolling list then throws the other cards off by the stale amount at every reorder (seen 2026-10-15). Reorder slides need their own undelayed `layout` transition, or the staggered entrance delay leaves an empty slot behind a dragged card.
31. **Workers AI's response field is not always a string**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` has returned `response` as a parsed object, and OpenAI-style `choices` have been seen. On 2026-10-15 a Cerebras 429 (`queue_exceeded`, high traffic) fell back to Llama, `result.response.trim()` threw, `/clarify` returned 500 and the creator was bounced to the build screen. `runJsonCompletion` now reads the text through `textFromWorkersAi()` (string, `response`, `text`, `choices`, object → JSON) and `runCerebras` retries a 429 once after 700 ms. The frontend never leaves the screen when a follow-up fails: it toasts and stays (`fetchNextQuestion` in `CreatorPage`).
34. **The background transcription hand-off did not run from the WhatsApp webhook** (2026-10-26): a response submitted by the bot sat with three `pending` answers and no Whisper call ever fired (PostHog had `response_submitted` and nothing after). Cause not pinned down (the same `executionCtx.waitUntil(transcribeResponseAnswers)` works from the web submit route). Fixed by not depending on it there: the bot transcribes each voice note on receipt and submits rows complete; `sweepPendingTranscriptions()` (`services/transcription.ts`) picks up any submitted response with `pending` rows older than 2 min, and runs after every WhatsApp delivery (1 response, awaited), on dashboard open (`POST /api/my/surveys/:id/read`, 5) and nightly in the agent (10). If web answers ever stick, the same sweep heals them.
33. **A Worker cannot fetch its own custom domain**: `fetch("https://api.parlo.me/…")` from inside `parlo-backend` answers 522 (seen 2026-10-25 testing `intro/from-url` with a signed `/api/audio/…` URL). Read R2 directly for anything already ours; the same rule is why the MCP worker talks to the backend over a Service Binding.
32. **Migration 0015 is applied in production but nothing reads it**: `users.voice_id` / `voice_sample_r2_key` / `voice_cloned_at` and `surveys.intro_kind` came with the voice-first opening (Inworld voice clone → opener screen), built on 2026-10-24 and parked on 2026-10-25 (GROWTH.md). The code lives on `feature/voice-first-opening` (`0d387a3`: `routes/voice.ts`, `services/inworld.ts`, `VoiceSampleScreen`, `OpenerScreen`). The migration file is kept so `d1_migrations` matches the folder; 0016 (`timing`) followed it on 2026-10-25, so number the next one 0017. The `INWORLD_API_KEY` secret is still on the Worker, in GitHub Actions and in `backend/.dev.vars`, unused.

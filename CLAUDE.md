# Parlo

Voice interview app. Creators speak (or type) their agent config, share via WhatsApp, and participants respond by voice.

## Rules for Agents

1. **Read this file before making changes.** It documents API contracts, naming conventions, and known pitfalls.
2. **Update this file** whenever you add or change an API endpoint, rename a key, add a new service, or discover a new pitfall. Keep it in sync with the code.
3. **Verify API response shapes** by reading the actual backend route handler before writing frontend code that calls it. Do not guess field names.
4. **Use the exact deploy commands** listed below. Getting these wrong deploys to the wrong target.

## Project Structure

```
parlo/
  frontend/          — React+Vite app on Cloudflare Pages (parlo.me)
  backend/           — Cloudflare Worker + Hono (api.parlo.me)
  fe_experiments/    — Original prototypes (reference only, not deployed)
```

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite (SWC), Tailwind CSS, shadcn/ui, Framer Motion
- **Backend:** Cloudflare Workers, Hono router, TypeScript
- **Database:** Cloudflare D1 (SQLite)
- **Audio Storage:** Cloudflare R2 (presigned upload URLs with one-time tokens)
- **AI:** Cerebras `gpt-oss-120b` for question generation (secret `CEREBRAS_API_KEY`; falls back to Workers AI Llama 3.3 70B if the key is missing or the call fails) + Cloudflare Workers AI Whisper (STT — Cerebras has no speech-to-text)
- **TypeSafe (typed AI judgments):** secret `TYPESAFE_API_KEY` — set as a GitHub Actions secret (synced to the Worker on deploy), already on the `parlo-backend` Worker, and in the gitignored `backend/.dev.vars` for local work and agents (`wrangler dev` reads it automatically). Read it from `c.env.TYPESAFE_API_KEY` server-side only; never ship it to the frontend or commit it. Current key is a pre-launch dev key — rotate before going live. Use the `typesafe-ai` skill when building with it; docs at https://docs.typesafe.ai/llms.txt
- **WhatsApp:** Kapso.ai (@kapso/whatsapp-cloud-api)
- **Phone Auth:** Firebase Phone Auth (SMS OTP) + WhatsApp OTP fallback via Kapso
- **Photo capture:** native `<input type="file" capture="environment">` + `browser-image-compression` (client-side JPEG transcode at 1080px / ~1MB / 0.85 quality)
- **Video capture:** native `<input type="file" accept="video/*" capture="environment">` (60s + 25MB hard caps, vertical-only, no client compression — relies on phone's hardware H.264 encoder)
- **Analytics:** PostHog (US region, project 653180 under andrej@parlo.me) — frontend + backend events + LLM observability
- **Auth (admin):** Cloudflare Access (Google Workspace @parlo.me)
- **Auth (API):** API key (`pk_` prefix) per creator, stored in D1. Header: `X-Parlo-Api-Key` or `Authorization: Bearer pk_...`
- **Offline persistence:** IndexedDB (sessionStore.ts) — stores session state + audio blobs
- **Background uploads:** uploadQueue.ts — uploads blobs as recorded, retries on failure/offline
- **Audio merge:** audioMerge.ts — merges multi-segment recordings into single WAV for upload
- **E2E Testing:** Playwright (frontend/e2e/) — mock audio + API fixtures. Happy-path specs + cross-device visual audit (`device-audit.spec.ts`) covering iPhone SE, Pixel 7, iPhone 15 Pro Max.

## API Contracts

IMPORTANT: When building frontend features that call the backend, always verify the actual response shape by reading the backend route handler. Do NOT guess field names.

### POST /api/surveys
Creates a survey. Accepts empty body or `{creatorPhone?, creatorName?, title?}`.
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
Triggers AI pipeline. Two modes:
- **Agent brief flow (current):** body `{brief: string, clarifications: [{question, answer}]}`. Text only — no R2 audio is read. Stores `brief` and `brief_clarifications` (JSON) on the `surveys` row.
- **Legacy flow (MCP server):** body optional `{textAnswers?: {audience?: string, gather?: string}}`; transcribes `surveys/{id}/audience|gather.webm` from R2 for whatever is missing.

Both modes **replace** the survey's questions (delete + insert), so Regenerate doesn't pile up duplicates. Defaults to 5 questions in brief mode, 3 in legacy mode, unless the creator asked for a number.
Returns:
```json
{
  "title": "string",
  "questions": [{"text": "string", "hint": "string", "type": "voice | photo | video"}]
}
```

### PUT /api/surveys/:id/questions
Update survey questions after generation. Body: `{questions: [{text: string, hint?: string}]}`.
Deletes existing questions and inserts replacements with correct sort_order.
Returns:
```json
{
  "questions": [{"id": "string", "survey_id": "string", "sort_order": number, "text": "string", "hint": "string | null"}]
}
```

### GET /api/s/:code
Get survey for participant. Returns:
```json
{
  "id": "string",
  "title": "string | null",
  "status": "string",
  "questions": [{"id": "string", "survey_id": "string", "sort_order": number, "text": "string", "hint": "string | null"}],
  "audioKeys": [{"questionKey": "string", "audioR2Key": "string"}]
}
```
Note: Frontend must map this to its own Survey type (see api/client.ts useGetSurvey).

### POST /api/s/:code/responses
Start a response session. Returns:
```json
{
  "id": "string",
  "code": "string (8-char)",
  "uploadUrls": {"<questionId>": "string (presigned URL)"}
}
```

### POST /api/responses/:id/submit
Submit response. Body: `{phone?: string, firstName?: string, lastName?: string}`.
Creates `response_answers` rows by checking R2 for uploaded audio (.webm then .wav) per question.
Triggers background Whisper transcription via `waitUntil()`.
Returns: `{success: true, id: "string"}`

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
Open Graph preview image for share URLs. Generates a unique 1200×630 PNG per survey in Vienna Secession style (tiled SVG pattern, cream card with title).
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
Returns: `{verified: true}` or `{verified: false}`

### GET /api/auth/validate
Validate an API key. Requires `X-Parlo-Api-Key` header or `Authorization: Bearer pk_...`.
If valid, returns `{ "valid": true, "creatorId": "string" }`.
If no key or invalid key, returns 401 `{ "valid": false }`.

### GET /api/d/:dashboardCode
Creator dashboard data. Returns response list with signed audio URLs + transcriptions.
Each answer includes `transcription` (string | null) and `transcriptionStatus` ("pending" | "completed" | "failed").

### GET /api/r/:code
Public results (open surveys only). Returns first names + audio.

### POST /api/webhooks/whatsapp
Kapso webhook receiver. Handles:
- `survey <code>` → creator notification opt-in
- `response <code>` → participant confirmation + creator notification
- Unknown → fallback message

Requests must carry a valid `X-Webhook-Signature` (hex HMAC-SHA256 of the raw body with `KAPSO_WEBHOOK_SECRET`); otherwise 401. If the secret isn't set the endpoint returns 500 rather than accepting unsigned calls.

### GET /api/my/surveys
List all surveys for the authenticated creator. Requires `X-Parlo-Api-Key` header or `Authorization: Bearer pk_...`.
Returns 401 if no valid API key provided.
Returns:
```json
{
  "surveys": [{
    "id": "string",
    "code": "string",
    "dashboardCode": "string",
    "title": "string | null",
    "status": "string",
    "createdAt": "string (ISO datetime)",
    "questionCount": "number",
    "responseCount": "number (submitted only)"
  }]
}
```

### POST /api/surveys/:id/creation-events
Browser-side creation log. Body: `{events: [{kind, idx?, payload?, at?}]}` (max 50 per call, 8 KB per payload, 600/hr per IP). Only kinds in `CLIENT_EVENT_KINDS` (`backend/src/services/creationLog.ts`) are accepted: `brief_submitted`, `clarify_answered`, `checkpoint`, `back`, `review_opened`, `review_edit`, `review_delete`, `review_add`, `review_reorder`, `review_confirm_tapped`, `regenerate`. Server-only kinds (`generated`, `clarify_generated`, `clarify_judged`, `review_confirmed`) are written by the routes themselves. Rows land in D1 `creation_events`; the frontend batches via `lib/creationLog.ts` (`logCreation(surveyId, kind, payload, idx?)`).
Returns: `{ok: true, accepted: number}`

### Admin API (header `X-Parlo-Admin-Key`)
Cloudflare Access only fronts the parlo.me/admin **page**; api.parlo.me/api/admin/* is gated by the shared secret `ADMIN_API_KEY` (Worker secret, GitHub secret, `backend/.dev.vars`) via `middleware/adminAuth.ts`, failing closed (503) if unset and 401 without the header. The admin page asks for the key once (`lib/adminKey.ts`, localStorage) and `apiFetch` attaches it to `/admin/*` calls.
- GET /api/admin/prompts — list prompts
- GET /api/admin/prompts/:name — get prompt with version history
- POST /api/admin/prompts/:name — save new version `{content, createdBy?}`
- POST /api/admin/prompts/:name/revert — revert `{version: number}`
- GET /api/admin/prompts/seed — initialize defaults
- GET /api/admin/creations?limit&offset&includeTest=1 — one row per agent creation (brief ticks, follow-ups, checkpoint choices, Jev flags, review diff summary, label count)
- GET /api/admin/creations/stats?days=30&includeTest=1 — calibration aggregates: brief skip/voice rate, mean time-to-tick per item, mean final probability per item, follow-ups per creation, "Ask me more" rate, Jev-flagged follow-up rates (redundant/misaddressed/vague), review kept/survived/untouched ratios, label precision
- GET /api/admin/creations/:id — the full story: brief + `briefEval`, clarifications, `generatedQuestions` vs `finalQuestions`, `reviewDiff`, ordered `events`, `labels`
- POST /api/admin/creations/:id/labels — `{targetKind: "brief_item"|"clarify"|"question", targetKey, verdict: "good"|"bad"|"clear", note?}`; one verdict per target (upsert); author from `cf-access-authenticated-user-email`

Routes live in `backend/src/routes/adminCreations.ts`; UI is the Creations tab at parlo.me/admin (`components/admin/CreationsPanel.tsx`).

## Creator flow (agent brief)

```
welcome → brief → clarify ×N (checkpoint after answer 2, 5, 10, 15…) → building → review → phone → otp → linkedin → ready
```

- **Brief** (`components/creator/BriefScreen.tsx`): one screen, mic auto-starts, the creator describes their research agent in one go. Five checklist items (`lib/briefChecklist.ts`: audience, goal, purpose, tone, length) tick green live. `hooks/useLiveTranscript.ts` streams words (Web Speech API first, Whisper polling via `/transcribe` as fallback); `hooks/useBriefChecklist.ts` debounces the transcript ~650 ms and calls `/brief/evaluate` (TypeSafe Jev). "Continue" unlocks when all five are ticked; a subtle "Continue without the rest" link appears once 3+ are ticked so nobody gets stuck. "Type instead" keeps the heard text in the textarea; switching back to voice seeds the transcript with what was typed. The recording is uploaded to `surveys/{id}/brief.webm` in the background for future use; only the transcript feeds the pipeline today.
- **Clarify** (`CreationQuestionScreen` with `transcriptSurveyId`, `progressLabel`, `ctaLabel`): one Cerebras follow-up per screen via `/clarify`. The live transcript means the answer text is ready the moment the creator taps Continue, so the next question appears in ~0.5 s. Back re-opens the previous follow-up (or the brief) in text mode with the answer editable.
- **Checkpoint** (`CheckpointScreen.tsx`): after answer 2, then every answer where `isClarifyCheckpoint(n)` holds (5, 10, 15…): "Create agent" or "Ask me more". Hard cap `MAX_CLARIFICATIONS = 20`.
- **Building/Review/Ready**: unchanged. `handleGenerate` posts `{brief, clarifications}`.
- Checklist ids/order are duplicated in `frontend/src/lib/briefChecklist.ts` and `backend/src/services/brief.ts` — change both together.
- The legacy two-question flow (`CREATION_QUESTIONS`, audience/gather) is no longer reachable from the UI; the MCP server still uses the legacy generate mode.

## Creation analytics (model calibration)

Everything needed to judge whether Jev (brief checklist) and Cerebras (follow-ups, generation) are calibrated:

- **One PostHog trace per creation**, id `survey-<surveyId>`: every `/brief/evaluate`, `/clarify`, judge and `/generate` call is an `$ai_generation` on it, with tokens and `$ai_total_cost_usd` (TypeSafe $0.042/M in; Cerebras $0.35/M in, $0.75/M out). Custom props: `purpose` (`brief-checklist`, `clarify`, `clarify-judge`, `generate-brief`, `generate-legacy`), `$ai_prompt_version_*`.
- **Jev judges Cerebras** (`backend/src/services/clarifyJudge.ts`): after each follow-up is generated, three Noul questions score it off the request path (`redundant`, `misaddressed`, `vague`, flag at ≥ 0.7). Stored as creation event `clarify_judged` and PostHog event `clarify_question_judged`.
- **Review diff** (`backend/src/services/reviewDiff.ts`): `PUT /questions` diffs the confirmed set against `surveys.generated_questions` (what the model wrote, saved at generate time) by normalised Levenshtein similarity → kept / reworded (< 0.97) / added / deleted (< 0.5 match) / moved (LIS). Stored as `surveys.review_diff`, creation event `review_confirmed`, PostHog event `review_confirmed` (`keptRatio`, `survivedRatio`, `untouchedRatio`, `changed`, `clarificationCount`). `generated_questions` and `review_diff` are reset on every regenerate. **Edit rate is the calibration metric for generation.**
- **Creation log** (D1 `creation_events`, `lib/creationLog.ts` + `/creation-events`): the browser posts `brief_submitted` (mode, source, duration, `skipped`, tick timeline, final probabilities), `clarify_answered`, `checkpoint` (`choice: create|continue`), `back`, `review_opened`, `review_edit` (before/after/similarity), `review_delete`, `review_add`, `review_reorder` (final order of generated indices), `review_confirm_tapped`, `regenerate`. Same facts go to PostHog via `trackEvent` under the same names.
- **Human labels** (D1 `creation_labels`): 👍/👎 per brief item, follow-up and question from the admin Creations tab; precision shows in the stats header. Use them to re-tune `BRIEF_SATISFIED_THRESHOLD` and the judge threshold.
- **PostHog dashboard "Agent creation"** (id 2194212, https://us.posthog.com/project/653180/dashboard/2194212): creation funnel, brief skip rate, time to tick per item, checkpoint choices, Jev-flagged follow-ups, kept/survived ratios (also by follow-up count), review actions. Every tile filters `is_test is not set`. Server events use the survey id as distinct_id, so they can't sit in person funnels with browser events; funnels use browser events only.
- **Test traffic**: `lib/testMode.ts` turns on for localhost, `*.pages.dev`, or after visiting `parlo.me/?test=1` (persisted; `?test=0` clears). It adds `X-Parlo-Test: 1` to every API call (backend stamps `surveys.is_test` and `is_test: true` on server events via `initAnalytics` base props) and registers `is_test: true` on browser PostHog events. Filter dashboards with `is_test is not set`; the admin tab hides test rows unless "include test traffic" is ticked.
- Migration `0012_creation_analytics.sql` (applied to prod 2026-10-10).

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

OG images are generated dynamically by the backend Worker at `GET /api/og/:code.png` using `workers-og` (Satori port). Each survey gets a unique deterministic Vienna Secession-style design (tiled pattern + cream card with title).

## WhatsApp (Kapso)

- Bot number: **+1 201-578-9837**, phone number ID `1407538595771805`, WABA `1134962085529075`. Frontend wa.me links come from `frontend/src/lib/whatsapp.ts` (`buildBotChatUrl`) — never hardcode the number.
- Kapso webhook (phone-number scope, `kind: kapso`, payload v2, event `whatsapp.message.received`) points at `https://api.parlo.me/api/webhooks/whatsapp`.
- Worker secrets: `KAPSO_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET` (synced from GitHub secrets on deploy).
- Templates (en_US, UTILITY, **NAMED** params — send body params with `parameter_name`; URL button params stay positional):
  - `parlo_survey_ready` — `{{share_url}}`; button → `parlo.me/s/{code}`
  - `parlo_thanks` — `{{name}}`
  - `parlo_thanks_open` — `{{name}}`; button → `parlo.me/r/{surveyCode}`
  - `parlo_new_response` — `{{respondent}}`, `{{survey_title}}`, `{{response_count}}`; button → `parlo.me/d/{dashboardCode}`
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

# Backend (must use global wrangler with --name flag)
/Users/andrejzg/.npm-global/bin/wrangler deploy --name parlo-backend --config /Users/andrejzg/work/repos/parlo/backend/wrangler.toml
```

WARNING: Running `wrangler deploy` from the backend directory without `--name parlo-backend` may deploy to the wrong worker name. Always use the full command above.

## Design Conventions

- Mobile-first, dark theme default
- Stage-based state machine pattern (Index/Page.tsx orchestrates flows)
- TypeForm-inspired animations with Framer Motion
- Orange accent color (hsl 22 95% 62%), Syne (display) + Inter (body) sans pairing for UI; Cormorant Garamond serif (`font-serif`) reserved for big question headings (QuestionScreen / PhotoQuestionScreen / VideoQuestionScreen / CreationQuestionScreen) and the unlogged-in landing headline (CreateLanding) — evokes 1980s Apple marketing type, i.e. ITC Garamond Condensed used on Mac manuals and "Think Different" era ads. Do not apply `font-serif` elsewhere.
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
- **Phone auth with OTP**: After review, participants enter their phone number. Firebase sends an SMS OTP; if SMS doesn't arrive, WhatsApp OTP fallback is available. On verified devices (IndexedDB `deviceAuth` store), phone+OTP is skipped entirely.
- **Device recognition**: After OTP verification, a device token is stored in IndexedDB (30-day TTL). Returning participants on the same device/browser skip phone+OTP.

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
- `e2e/device-audit.spec.ts` — visual audit across **iPhone SE / Pixel 7 / iPhone 15 Pro Max**. Two passes per device: (1) voice-only happy path captures welcome → consent → voice Q → review → phone, (2) two mini mixed-type surveys capture the welcome/consent/capture screens for photo and video. 33 screenshots total dropped in `/tmp/parlo-<device>/`. ~60s runtime. Use this whenever you touch participant-facing UI — grep for layout regressions across small / medium / large viewports in one shot.
- `e2e/creator/brief-flow.spec.ts` — the creator flow on the same three devices, in "Type instead" mode with `/surveys`, `/brief/evaluate`, `/clarify`, `/generate` stubbed: brief (partial → complete ticks, CTA gating) → 2 follow-ups → checkpoint → 3 more → checkpoint → building → review with voice/photo/video badges. 8 screenshots per device in `$PARLO_SHOTS_DIR/parlo-creator-<device>/` (`/tmp` by default). Playwright's Chromium has no speech engine, so the voice path can't be covered here — test it on a real phone.

**Important**: Playwright specs need a running preview server, NOT the Vite dev server — `npm run dev` doesn't load `.env.production`, so Firebase init throws `auth/invalid-api-key` and the React app never mounts (blank white page in screenshots). Start a preview server first:

```bash
npx vite build && npx vite preview --port 5173 --host 127.0.0.1 &
# then run playwright
npx playwright test e2e/device-audit.spec.ts --project=chromium --reporter=list
```

The `playwright.config.ts` `webServer` hook is set to `npm run dev`, which is correct for tests that mock Firebase entirely, but for device-audit (which hits the real app bootstrap) you must use preview.

## Common Pitfalls

1. **API response shapes**: Backend returns DB row shapes (snake_case, extra fields). Frontend must map to its own types. Always check the actual route handler.
2. **Empty body parsing**: Hono's `c.req.json()` throws on empty body. Use `.catch(() => ({}))` for optional bodies.
3. **Backend deploy**: Must use `--name parlo-backend` flag or it deploys to wrong worker.
4. **KV list eventual consistency**: `kv.list()` may not find recently written keys. Check known keys directly.
5. **Rate limiting**: Survey creation is rate-limited (100/hr per IP). Can hit this during development.
6. **Upload tokens are one-time-use**: Once consumed by `validateUploadToken`, the token is deleted from KV. Never retry an upload with a potentially consumed token — always call `refresh-urls` first.
7. **CORS**: Backend restricts origins to `parlo.me` and `localhost:5173`/`localhost:4173`. If adding a new frontend domain, update the CORS config in `backend/src/index.ts`.
8. **AnimatePresence overlaps**: During page transitions, both entering and exiting screens render simultaneously (`mode="sync"`). Use `.first()` in Playwright tests when locating elements that exist on both screens (e.g., "Next" button, timer badge).
9. **Playwright tests must run from `frontend/` directory**: The config is at `frontend/playwright.config.ts`. Running from repo root will fail with "project not found".
10. **Blob URL lifecycle**: If a component creates an object URL with `URL.createObjectURL(blob)` and passes it up to a parent (e.g. `PhotoQuestionScreen` → `ParticipantPage`), do NOT revoke that URL on unmount. The parent will use it downstream (Review, Thank You), and an unmount-time revoke kills those previews — the `<img>` then renders broken with alt-text fallback, which looks exactly like a text card. Only revoke when replacing the URL with a new one inline (e.g. on retake). The browser will GC the URL when the underlying blob is no longer referenced.
11. **Flex scroll containers need `min-h-0`**: Any `flex-1 overflow-y-auto` child of a `flex-col` parent must also have `min-h-0`, otherwise the flex item keeps its default `min-height: auto` (= content size) and refuses to shrink, so `overflow-y-auto` never activates. Content overflows past the viewport and gets clipped behind the bottom CTA. Affects `ReviewScreen`, `ThankYouScreen`, `QuestionScreen`, `PhotoQuestionScreen`, `VideoQuestionScreen` — all of them have `min-h-0` applied; don't remove it.
12. **Playwright device audit needs `vite preview`, not `vite dev`**: See E2E Tests section. Dev server runs without `.env.production`, so Firebase throws and the app never renders. Always run `vite preview` after `vite build` for audit runs.
13. **Welcome/Consent copy adapts to media mix**: Don't hardcode "voice responses" / "Start recording" strings — use `getMediaMix()` from `lib/mediaMix.ts`. See the "Media-mix copy adaptation" section above.
14. **Secret sync must run before `wrangler deploy` in CI**: `wrangler secret bulk` PATCHes Worker settings and re-sends the non-secret bindings it reads back. On 2026-10-09 that read raced the deploy that had just finished and the PATCH wiped D1/R2/KV/AI, so every request 500'd with `Cannot read properties of undefined (reading 'get')`. `deploy.yml` now syncs secrets first, deploys last (bindings from `wrangler.toml` always win, secrets are kept), and a "Verify Worker bindings" step fails the job if DB/AUDIO_BUCKET/KV/AI are missing. If you ever see that error in prod, re-run the backend deploy command — it restores the bindings.
15. **Web Speech API isn't everywhere**: `useLiveTranscript` falls back to Whisper (`/transcribe`) when `SpeechRecognition` is missing, errors with `network`/`not-allowed`/etc., or the watchdog hears voice for 2.5 s with no words after 8 s. Chrome restarts recognition every ~60 s (handled in `onend`); Safari and Chrome disagree on `resultIndex`, so results are always rebuilt from the full `results` list. Firefox and Playwright's Chromium always use the fallback.
16. **Brief checklist ids live in two places**: `frontend/src/lib/briefChecklist.ts` (labels/hints) and `backend/src/services/brief.ts` (TypeSafe rubric). Keep ids and order identical.

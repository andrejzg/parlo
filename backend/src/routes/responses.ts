import { Hono } from "hono";
import type { Env, Survey, SurveyQuestion, StartResponseResponse, SubmitResponseRequest, GroupVisibility } from "../types";
import { generateId, generateCode } from "../services/codes";
import { extractCode } from "../services/slug";
import { generatePresignedUploadUrl, generateUploadToken } from "../services/r2";
import { checkRateLimit } from "../services/ratelimit";
import { trackServerEvent } from "../services/analytics";
import { transcribeResponseAnswers } from "../services/transcription";
import { ensureMember, getMemberByToken, upsertUserByPhone } from "../services/groups";
import { latestSentRound, pendingAsksFor } from "../services/rounds";
import { notifyManagers } from "../services/notify";

const responses = new Hono<{ Bindings: Env }>();

// Returns the R2 key for a given response answer based on the question type.
// Voice questions get .webm, photo questions get .jpg, video questions get .mp4
// (the .mp4 extension is used even for iOS QuickTime uploads — the bytes are
// stored as-is and the browser detects the codec from the bytes, not the name).
function answerR2Key(responseId: string, q: SurveyQuestion): string {
  const ext =
    q.question_type === "photo" ? "jpg" :
    q.question_type === "video" ? "mp4" :
    "webm";
  return `responses/${responseId}/${q.id}.${ext}`;
}

async function uploadUrlsFor(c: { env: Env; req: { url: string } }, responseId: string, questions: SurveyQuestion[]) {
  const baseUrl = new URL(c.req.url).origin;
  const uploadUrls: Record<string, string> = {};
  for (const q of questions) {
    const r2Key = answerR2Key(responseId, q);
    const token = await generateUploadToken(c.env.KV, r2Key);
    uploadUrls[q.id] = generatePresignedUploadUrl(baseUrl, r2Key, token);
  }
  return uploadUrls;
}

// ── POST /api/s/:code/responses ── Start a response session
//
// `?t=<member token>` (from a personal link or a previous visit) identifies
// the member, so the session only gets upload URLs for the asks that are
// still pending for them — including probes aimed at them.
responses.post("/api/s/:code/responses", async (c) => {
  const code = extractCode(c.req.param("code"));
  const db = c.env.DB;

  const survey = await db
    .prepare("SELECT * FROM surveys WHERE code = ? AND status = 'active'")
    .bind(code)
    .first<Survey>();

  if (!survey) {
    return c.json({ error: "Survey not found or inactive" }, 404);
  }

  // Rate limit: 50 responses per survey per hour
  const allowed = await checkRateLimit(c.env.KV, "response-create", survey.id, 50);
  if (!allowed) {
    return c.json({ error: "Response rate limit exceeded for this survey" }, 429);
  }

  const member = await getMemberByToken(db, survey.id, c.req.query("t"));
  const questions = await pendingAsksFor(db, survey.id, member?.user_id ?? null);
  const round = await latestSentRound(db, survey.id);

  const responseId = generateId();
  const responseCode = generateCode(10);

  await db
    .prepare("INSERT INTO responses (id, code, survey_id, user_id, round_id) VALUES (?, ?, ?, ?, ?)")
    .bind(responseId, responseCode, survey.id, member?.user_id ?? null, round?.id ?? null)
    .run();

  const uploadUrls = await uploadUrlsFor(c, responseId, questions);

  trackServerEvent(responseId, "response_started", {
    surveyId: survey.id,
    surveyCode: code,
    responseId,
    round: round?.number ?? 1,
    asMember: !!member,
  });

  const result: StartResponseResponse = {
    id: responseId,
    code: responseCode,
    uploadUrls,
  };

  return c.json(result, 201);
});

// ── POST /api/responses/:id/submit ── Submit response with contact info
//
// Answering is joining: a verified phone becomes (or finds) a user and a
// member of the parlo. The group's visibility is stamped on the response so
// loosening it later never exposes answers given under a private policy.
responses.post("/api/responses/:id/submit", async (c) => {
  const responseId = c.req.param("id");
  const db = c.env.DB;
  const body = await c.req.json<SubmitResponseRequest>().catch(() => ({} as SubmitResponseRequest));

  const existing = await db
    .prepare("SELECT id, survey_id, status, user_id FROM responses WHERE id = ?")
    .bind(responseId)
    .first<{ id: string; survey_id: string; status: string; user_id: string | null }>();

  if (!existing) {
    return c.json({ error: "Response not found" }, 404);
  }

  if (existing.status !== "in_progress") {
    return c.json({ error: "Response already submitted" }, 400);
  }

  const survey = await db.prepare("SELECT * FROM surveys WHERE id = ?").bind(existing.survey_id).first<Survey>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);
  const visibility: GroupVisibility = survey.visibility === "open" ? "open" : "private";

  // Identity: a verified phone → user → member.
  let userId = existing.user_id;
  if (body.phone) {
    const user = await upsertUserByPhone(db, body.phone, { firstName: body.firstName ?? null, lastName: body.lastName ?? null });
    userId = user.id;
  }
  let memberToken: string | null = null;
  if (userId) {
    const membership = await ensureMember(db, existing.survey_id, userId, "member");
    memberToken = membership.removed_at ? null : membership.access_token;
  }

  await db
    .prepare(
      `UPDATE responses
       SET phone = ?, first_name = ?, last_name = ?, user_id = ?, visibility_at_submit = ?,
           status = 'submitted', submitted_at = datetime('now')
       WHERE id = ?`
    )
    .bind(body.phone ?? null, body.firstName ?? null, body.lastName ?? null, userId, visibility, responseId)
    .run();

  // Create response_answers rows for each uploaded file
  const questions = await db
    .prepare("SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order")
    .bind(existing.survey_id)
    .all<SurveyQuestion>();

  const insertStatements = [];
  for (const q of questions.results) {
    // Probes aimed at someone else can't have been answered here.
    if (q.target_user_id && q.target_user_id !== userId) continue;

    if (q.question_type === "photo") {
      const jpgKey = `responses/${responseId}/${q.id}.jpg`;
      const jpgObj = await c.env.AUDIO_BUCKET.head(jpgKey);
      if (jpgObj) {
        insertStatements.push(
          db
            .prepare(
              // audio_r2_key is NOT NULL on the schema, so store an empty
              // string for photo answers; the real key lives in image_r2_key.
              "INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, image_r2_key, duration_ms, transcription_status) VALUES (?, ?, ?, '', ?, 0, 'completed')"
            )
            .bind(generateId(), responseId, q.id, jpgKey)
        );
      }
      continue;
    }

    if (q.question_type === "video") {
      const mp4Key = `responses/${responseId}/${q.id}.mp4`;
      const mp4Obj = await c.env.AUDIO_BUCKET.head(mp4Key);
      if (mp4Obj) {
        insertStatements.push(
          db
            .prepare(
              "INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, video_r2_key, duration_ms, transcription_status) VALUES (?, ?, ?, '', ?, 0, 'pending')"
            )
            .bind(generateId(), responseId, q.id, mp4Key)
        );
      }
      continue;
    }

    // Voice answer (default) — check .webm then .wav fallback
    const webmKey = `responses/${responseId}/${q.id}.webm`;
    const wavKey = `responses/${responseId}/${q.id}.wav`;

    const webmObj = await c.env.AUDIO_BUCKET.head(webmKey);
    const audioKey = webmObj ? webmKey : null;

    if (!audioKey) {
      const wavObj = await c.env.AUDIO_BUCKET.head(wavKey);
      if (wavObj) {
        insertStatements.push(
          db
            .prepare(
              "INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, duration_ms, transcription_status) VALUES (?, ?, ?, ?, 0, 'pending')"
            )
            .bind(generateId(), responseId, q.id, wavKey)
        );
      }
    } else {
      insertStatements.push(
        db
          .prepare(
            "INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, duration_ms, transcription_status) VALUES (?, ?, ?, ?, 0, 'pending')"
          )
          .bind(generateId(), responseId, q.id, webmKey)
      );
    }
  }

  if (insertStatements.length > 0) {
    await db.batch(insertStatements);
  }

  trackServerEvent(body.phone ?? responseId, "response_submitted", {
    responseId,
    surveyId: existing.survey_id,
    hasPhone: !!body.phone,
    joined: !!memberToken,
    visibility,
  });

  if (body.phone) {
    trackServerEvent(body.phone, "$identify", {
      $set: {
        phone: body.phone,
        first_name: body.firstName,
        last_name: body.lastName,
        role: "participant",
      },
    });
  }

  // Tell the owner and admins (Inbox).
  const firstName = body.firstName ?? "Someone";
  const surveyTitle = survey.title ?? "Untitled";
  await notifyManagers(c.env, existing.survey_id, {
    type: "new_response",
    title: `${firstName} responded to ${surveyTitle}`,
    surveyId: existing.survey_id,
    surveyTitle,
  });

  // Transcribe in the background; the agent ingests once that lands.
  c.executionCtx.waitUntil(transcribeResponseAnswers(c.env, responseId));

  return c.json({ success: true, id: responseId, memberToken, visibility });
});

// ── POST /api/responses/:id/refresh-urls ── Fresh upload URLs for an in-progress session
responses.post("/api/responses/:id/refresh-urls", async (c) => {
  const responseId = c.req.param("id");
  const db = c.env.DB;

  const existing = await db
    .prepare("SELECT id, survey_id, status, user_id FROM responses WHERE id = ?")
    .bind(responseId)
    .first<{ id: string; survey_id: string; status: string; user_id: string | null }>();

  if (!existing) {
    return c.json({ error: "Response not found" }, 404);
  }

  if (existing.status !== "in_progress") {
    return c.json({ error: "Response already submitted" }, 400);
  }

  const questions = await pendingAsksFor(db, existing.survey_id, existing.user_id);
  const uploadUrls = await uploadUrlsFor(c, responseId, questions);

  return c.json({ uploadUrls });
});

export default responses;

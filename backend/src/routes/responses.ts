import { Hono } from "hono";
import type {
  Env,
  Survey,
  SurveyQuestion,
  StartResponseResponse,
  SubmitResponseRequest,
} from "../types";
import { generateId, generateCode } from "../services/codes";
import { extractCode } from "../services/slug";
import { generatePresignedUploadUrl, generateUploadToken } from "../services/r2";
import { checkRateLimit } from "../services/ratelimit";
import { trackServerEvent } from "../services/analytics";
import { transcribeResponseAnswers } from "../services/transcription";

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

// ── POST /api/s/:code/responses ── Start a response session
responses.post("/api/s/:code/responses", async (c) => {
  const code = extractCode(c.req.param("code"));
  const db = c.env.DB;

  // Look up active survey by code
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

  // Get questions so we can generate upload URLs per question
  const questions = await db
    .prepare(
      "SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order"
    )
    .bind(survey.id)
    .all<SurveyQuestion>();

  // Create the response row
  const responseId = generateId();
  const responseCode = generateCode(10);

  await db
    .prepare(
      "INSERT INTO responses (id, code, survey_id) VALUES (?, ?, ?)"
    )
    .bind(responseId, responseCode, survey.id)
    .run();

  // Generate upload URLs with one-time tokens for each question answer
  const baseUrl = new URL(c.req.url).origin;
  const uploadUrls: Record<string, string> = {};

  for (const q of questions.results) {
    const r2Key = answerR2Key(responseId, q);
    const token = await generateUploadToken(c.env.KV, r2Key);
    uploadUrls[q.id] = generatePresignedUploadUrl(baseUrl, r2Key, token);
  }

  trackServerEvent(responseId, "response_started", {
    surveyId: survey.id,
    surveyCode: code,
    responseId,
  });

  const result: StartResponseResponse = {
    id: responseId,
    code: responseCode,
    uploadUrls,
  };

  return c.json(result, 201);
});

// ── POST /api/responses/:id/submit ── Submit response with contact info
responses.post("/api/responses/:id/submit", async (c) => {
  const responseId = c.req.param("id");
  const db = c.env.DB;
  const body = await c.req.json<SubmitResponseRequest>().catch(() => ({} as SubmitResponseRequest));

  // Check that the response exists and is in_progress
  const existing = await db
    .prepare("SELECT id, survey_id, status FROM responses WHERE id = ?")
    .bind(responseId)
    .first<{ id: string; survey_id: string; status: string }>();

  if (!existing) {
    return c.json({ error: "Response not found" }, 404);
  }

  if (existing.status === "submitted") {
    return c.json({ error: "Response already submitted" }, 400);
  }

  // Update with contact info and mark as submitted
  await db
    .prepare(
      `UPDATE responses
       SET phone = ?, first_name = ?, last_name = ?,
           status = 'submitted', submitted_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      body.phone ?? null,
      body.firstName ?? null,
      body.lastName ?? null,
      responseId
    )
    .run();

  // Create response_answers rows for each uploaded audio file
  const questions = await db
    .prepare(
      "SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order"
    )
    .bind(existing.survey_id)
    .all<SurveyQuestion>();

  const insertStatements = [];
  for (const q of questions.results) {
    if (q.question_type === "photo") {
      // Photo answer — check for the .jpg in R2
      const jpgKey = `responses/${responseId}/${q.id}.jpg`;
      const jpgObj = await c.env.AUDIO_BUCKET.head(jpgKey);
      if (jpgObj) {
        insertStatements.push(
          db
            .prepare(
              // audio_r2_key is NOT NULL on the schema, so store an empty
              // string for photo answers; the real key lives in image_r2_key.
              // transcription_status = 'completed' since there's nothing to
              // transcribe for an image.
              "INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, image_r2_key, duration_ms, transcription_status) VALUES (?, ?, ?, '', ?, 0, 'completed')"
            )
            .bind(generateId(), responseId, q.id, jpgKey)
        );
      }
      continue;
    }

    if (q.question_type === "video") {
      // Video answer — check for the .mp4 in R2 (even iOS .mov uploads land
      // here because we always present a .mp4 presigned URL).
      const mp4Key = `responses/${responseId}/${q.id}.mp4`;
      const mp4Obj = await c.env.AUDIO_BUCKET.head(mp4Key);
      if (mp4Obj) {
        insertStatements.push(
          db
            .prepare(
              // audio_r2_key empty (NOT NULL constraint), real key in
              // video_r2_key. transcription_status = 'pending' so the
              // background Whisper job picks it up — Whisper accepts the raw
              // video bytes and just reads the audio track.
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
    hasPhone: !!body.phone,
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

  // ── Auto-populate participants + notify creator ──
  if (body.phone) {
    const participantId = generateId();
    const notificationId = generateId();

    // Upsert participant
    await db
      .prepare(
        `INSERT INTO participants (id, phone, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT (phone) DO UPDATE
         SET first_name = COALESCE(excluded.first_name, participants.first_name),
             last_name = COALESCE(excluded.last_name, participants.last_name),
             updated_at = datetime('now')`
      )
      .bind(participantId, body.phone, body.firstName ?? null, body.lastName ?? null)
      .run();

    // Get the actual participant ID (may differ if phone already existed)
    const participant = await db
      .prepare("SELECT id FROM participants WHERE phone = ?")
      .bind(body.phone)
      .first<{ id: string }>();

    if (participant) {
      // Get creator info + survey title for the notification
      const creatorInfo = await db
        .prepare(
          `SELECT c.phone, s.title FROM creators c
           JOIN surveys s ON s.creator_id = c.id
           WHERE s.id = ?`
        )
        .bind(existing.survey_id)
        .first<{ phone: string | null; title: string | null }>();

      const surveyTitle = creatorInfo?.title ?? "Untitled";
      const firstName = body.firstName ?? "Someone";
      const notifTitle = `${firstName} responded to ${surveyTitle}`;

      const batchStatements = [
        db
          .prepare(
            `INSERT OR IGNORE INTO survey_participants (survey_id, participant_id, response_id, responded_at)
             VALUES (?, ?, ?, datetime('now'))`
          )
          .bind(existing.survey_id, participant.id, responseId),
      ];

      if (creatorInfo?.phone) {
        batchStatements.push(
          db
            .prepare(
              `INSERT INTO notifications (id, user_phone, type, title, body, survey_id, survey_title, created_at)
               VALUES (?, ?, 'new_response', ?, NULL, ?, ?, datetime('now'))`
            )
            .bind(notificationId, creatorInfo.phone, notifTitle, existing.survey_id, surveyTitle)
        );
      }

      await db.batch(batchStatements);
    }
  }

  // Run transcription in the background after responding
  c.executionCtx.waitUntil(transcribeResponseAnswers(c.env, responseId));

  return c.json({ success: true, id: responseId });
});

// ── POST /api/responses/:id/refresh-urls ── Generate fresh upload URLs for an existing response
responses.post("/api/responses/:id/refresh-urls", async (c) => {
  const responseId = c.req.param("id");
  const db = c.env.DB;

  // Check that the response exists and is still in_progress
  const existing = await db
    .prepare("SELECT id, survey_id, status FROM responses WHERE id = ?")
    .bind(responseId)
    .first<{ id: string; survey_id: string; status: string }>();

  if (!existing) {
    return c.json({ error: "Response not found" }, 404);
  }

  if (existing.status === "submitted") {
    return c.json({ error: "Response already submitted" }, 400);
  }

  // Get questions for this survey
  const questions = await db
    .prepare(
      "SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order"
    )
    .bind(existing.survey_id)
    .all<SurveyQuestion>();

  // Generate fresh upload URLs with new one-time tokens
  const baseUrl = new URL(c.req.url).origin;
  const uploadUrls: Record<string, string> = {};

  for (const q of questions.results) {
    const r2Key = answerR2Key(responseId, q);
    const token = await generateUploadToken(c.env.KV, r2Key);
    uploadUrls[q.id] = generatePresignedUploadUrl(baseUrl, r2Key, token);
  }

  return c.json({ uploadUrls });
});

export default responses;

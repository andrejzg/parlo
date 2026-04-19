import { Hono } from "hono";
import type {
  Env,
  CreateSurveyRequest,
  CreateSurveyResponse,
  GenerateSurveyRequest,
  GenerateSurveyResponse,
  Survey,
  SurveyQuestion,
  SurveyAudio,
  SurveyPublicView,
} from "../types";
import { generateId, generateCode } from "../services/codes";
import { extractCode } from "../services/slug";
import {
  generatePresignedUploadUrl,
  generateUploadToken,
} from "../services/r2";
import { checkRateLimit } from "../services/ratelimit";
import { transcribeAudio, generateQuestions } from "../services/ai";
import { trackServerEvent } from "../services/analytics";

const surveys = new Hono<{ Bindings: Env; Variables: { creatorId: string | null } }>();

// ── POST /api/surveys ── Create a new survey
surveys.post("/api/surveys", async (c) => {
  // Rate limit: 100 survey creations per IP per hour
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "survey-create", ip, 100);
  if (!allowed) {
    return c.json({ error: "Survey creation rate limit exceeded" }, 429);
  }

  const body = await c.req.json<CreateSurveyRequest>().catch(() => ({} as CreateSurveyRequest));
  const db = c.env.DB;

  // Upsert creator
  const creatorId = generateId();
  // Normalize phone: strip leading zeros after country code (+4407... → +447...)
  const creatorPhone = body.creatorPhone?.replace(/^(\+\d{1,4})0+/, "$1");
  if (creatorPhone) {
    const existing = await db
      .prepare("SELECT id FROM creators WHERE phone = ?")
      .bind(creatorPhone)
      .first<{ id: string }>();

    if (existing) {
      // Use existing creator
      var finalCreatorId = existing.id;
    } else {
      await db
        .prepare("INSERT INTO creators (id, phone, wa_name) VALUES (?, ?, ?)")
        .bind(creatorId, creatorPhone, body.creatorName ?? null)
        .run();
      var finalCreatorId = creatorId;
    }
  } else {
    // Anonymous creator
    await db
      .prepare("INSERT INTO creators (id) VALUES (?)")
      .bind(creatorId)
      .run();
    var finalCreatorId = creatorId;
  }

  // Create survey
  const surveyId = generateId();
  const code = generateCode(8);
  const dashboardCode = generateCode(12);

  await db
    .prepare(
      "INSERT INTO surveys (id, code, dashboard_code, creator_id, title) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(surveyId, code, dashboardCode, finalCreatorId, body.title ?? null)
    .run();

  // Generate or retrieve API key for the creator
  const existingCreator = await db
    .prepare("SELECT api_key FROM creators WHERE id = ?")
    .bind(finalCreatorId)
    .first<{ api_key: string | null }>();

  let apiKey = existingCreator?.api_key;
  if (!apiKey) {
    apiKey = `pk_${generateCode(32)}`;
    await db
      .prepare("UPDATE creators SET api_key = ? WHERE id = ?")
      .bind(apiKey, finalCreatorId)
      .run();
  }

  // Generate upload URLs with one-time tokens for the 2 audio clips
  const baseUrl = new URL(c.req.url).origin;
  const audienceKey = `surveys/${surveyId}/audience.webm`;
  const gatherKey = `surveys/${surveyId}/gather.webm`;

  const [audienceToken, gatherToken] = await Promise.all([
    generateUploadToken(c.env.KV, audienceKey),
    generateUploadToken(c.env.KV, gatherKey),
  ]);

  const response: CreateSurveyResponse = {
    id: surveyId,
    code,
    dashboardCode,
    apiKey,
    uploadUrls: {
      audience: generatePresignedUploadUrl(baseUrl, audienceKey, audienceToken),
      gather: generatePresignedUploadUrl(baseUrl, gatherKey, gatherToken),
    },
  };

  trackServerEvent(finalCreatorId, "survey_created", { surveyId, code, dashboardCode });

  return c.json(response, 201);
});

// ── POST /api/surveys/:id/generate ── Transcribe audio + generate questions via AI
surveys.post("/api/surveys/:id/generate", async (c) => {
  const surveyId = c.req.param("id");
  const db = c.env.DB;

  const survey = await db
    .prepare("SELECT id FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string }>();

  if (!survey) {
    return c.json({ error: "Survey not found" }, 404);
  }

  // Parse optional text answers from request body
  let textAnswers: GenerateSurveyRequest["textAnswers"] = {};
  try {
    const body = await c.req.json<GenerateSurveyRequest>();
    console.log("[generate] Raw request body:", JSON.stringify(body));
    textAnswers = body.textAnswers ?? {};
  } catch (e) {
    // No body or invalid JSON — fall back to audio-only flow
    console.log("[generate] No request body or invalid JSON, falling back to audio-only:", e);
  }

  console.log("[generate] Parsed textAnswers:", JSON.stringify(textAnswers));

  const hasAudienceText = !!textAnswers?.audience?.trim();
  const hasGatherText = !!textAnswers?.gather?.trim();

  console.log("[generate] hasAudienceText:", hasAudienceText, "hasGatherText:", hasGatherText);

  // 1. Fetch audio files from R2 only for fields without text answers
  let audienceText: string;
  let gatherText: string;

  const audioKeys = {
    audience: `surveys/${surveyId}/audience.webm`,
    gather: `surveys/${surveyId}/gather.webm`,
  };

  const [audienceObj, gatherObj] = await Promise.all([
    hasAudienceText ? null : c.env.AUDIO_BUCKET.get(audioKeys.audience),
    hasGatherText ? null : c.env.AUDIO_BUCKET.get(audioKeys.gather),
  ]);

  // Check that audio exists for any field that doesn't have text
  const missing = [
    !hasAudienceText && !audienceObj && "audience",
    !hasGatherText && !gatherObj && "gather",
  ].filter(Boolean);

  console.log("[generate] Audio lookup — audienceObj:", !!audienceObj, "gatherObj:", !!gatherObj, "missing:", missing);

  if (missing.length > 0) {
    console.log("[generate] Returning 400 — missing audio files:", missing);
    return c.json(
      { error: `Missing audio files: ${missing.join(", ")}` },
      400
    );
  }

  // 2. Transcribe audio files, or use provided text answers
  const traceId = `survey-${surveyId}`;
  const transcriptionPromises: [Promise<string>, Promise<string>] = [
    hasAudienceText
      ? Promise.resolve(textAnswers!.audience!.trim())
      : audienceObj!.arrayBuffer().then((buf) => transcribeAudio(c.env.AI, buf, traceId)),
    hasGatherText
      ? Promise.resolve(textAnswers!.gather!.trim())
      : gatherObj!.arrayBuffer().then((buf) => transcribeAudio(c.env.AI, buf, traceId)),
  ];

  [audienceText, gatherText] = await Promise.all(transcriptionPromises);

  console.log("[generate] Transcriptions — audience:", audienceText, "gather:", gatherText);

  // 3. Send transcriptions to Workers AI Llama to generate title + questions
  const generated = await generateQuestions(c.env.AI, c.env.KV, {
    audience: audienceText,
    gather: gatherText,
  });

  console.log("[generate] Generated result:", JSON.stringify(generated));

  // 4. Store title in surveys table and questions in survey_questions
  await db
    .prepare("UPDATE surveys SET title = ? WHERE id = ?")
    .bind(generated.title, surveyId)
    .run();

  // Insert the generated questions atomically
  const questionInsertStmts = generated.questions.map((q, i) => {
    const qId = generateId();
    const qType = q.type === "photo" ? "photo" : q.type === "video" ? "video" : "voice";
    return db
      .prepare(
        "INSERT INTO survey_questions (id, survey_id, sort_order, text, hint, question_type) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(qId, surveyId, i + 1, q.text, q.hint, qType);
  });
  await db.batch(questionInsertStmts);

  trackServerEvent(surveyId, "survey_questions_generated", {
    surveyId,
    title: generated.title,
    questionCount: generated.questions.length,
  });

  // 5. Return the generated data
  const response: GenerateSurveyResponse = {
    title: generated.title,
    questions: generated.questions,
  };

  return c.json(response);
});

// ── PUT /api/surveys/:id/questions ── Update survey questions
surveys.put("/api/surveys/:id/questions", async (c) => {
  const surveyId = c.req.param("id");
  const db = c.env.DB;

  const survey = await db
    .prepare("SELECT id FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string }>();

  if (!survey) {
    return c.json({ error: "Survey not found" }, 404);
  }

  const body = await c.req
    .json<{ questions: { text: string; hint?: string; type?: "voice" | "photo" | "video" }[] }>()
    .catch(() => null);

  if (!body?.questions || !Array.isArray(body.questions) || body.questions.length === 0) {
    return c.json({ error: "Request body must include a non-empty questions array" }, 400);
  }

  // Atomically delete existing questions and insert new ones
  const deleteStmt = db
    .prepare("DELETE FROM survey_questions WHERE survey_id = ?")
    .bind(surveyId);
  const insertStmts = body.questions.map((q, i) => {
    const qId = generateId();
    const qType = q.type === "photo" ? "photo" : q.type === "video" ? "video" : "voice";
    return db
      .prepare(
        "INSERT INTO survey_questions (id, survey_id, sort_order, text, hint, question_type) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(qId, surveyId, i + 1, q.text, q.hint ?? null, qType);
  });
  await db.batch([deleteStmt, ...insertStmts]);

  // Fetch the inserted questions to return them
  const updated = await db
    .prepare(
      "SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order"
    )
    .bind(surveyId)
    .all<SurveyQuestion>();

  trackServerEvent(surveyId, "survey_questions_updated", {
    surveyId,
    questionCount: body.questions.length,
  });

  return c.json({ questions: updated.results });
});

// ── GET /api/s/:code ── Get survey for participant
surveys.get("/api/s/:code", async (c) => {
  const code = extractCode(c.req.param("code"));
  const db = c.env.DB;

  const survey = await db
    .prepare("SELECT * FROM surveys WHERE code = ? AND status = 'active'")
    .bind(code)
    .first<Survey>();

  if (!survey) {
    return c.json({ error: "Survey not found or inactive" }, 404);
  }

  const questions = await db
    .prepare(
      "SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order"
    )
    .bind(survey.id)
    .all<SurveyQuestion>();

  const audio = await db
    .prepare("SELECT question_key, audio_r2_key FROM survey_audio WHERE survey_id = ?")
    .bind(survey.id)
    .all<{ question_key: string; audio_r2_key: string }>();

  const view: SurveyPublicView = {
    id: survey.id,
    title: survey.title,
    status: survey.status,
    questions: questions.results,
    audioKeys: audio.results.map((a) => ({
      questionKey: a.question_key,
      audioR2Key: a.audio_r2_key,
    })),
  };

  return c.json(view);
});

// ── POST /api/surveys/:id/claim ── Attach a verified phone to the survey's creator
surveys.post("/api/surveys/:id/claim", async (c) => {
  const surveyId = c.req.param("id");
  const db = c.env.DB;

  const body = await c.req.json<{ phone: string; name?: string }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ error: "Phone number is required" }, 400);
  }

  // Normalize: strip leading zeros after country code prefix
  // e.g. +4407976... → +447976...
  const phone = body.phone.replace(/^(\+\d{1,4})0+/, "$1");

  // Find the survey and its creator
  const survey = await db
    .prepare("SELECT id, creator_id FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string; creator_id: string }>();

  if (!survey) {
    return c.json({ error: "Survey not found" }, 404);
  }

  // Check if another creator already owns this phone
  const existingCreator = await db
    .prepare("SELECT id FROM creators WHERE phone = ? AND id != ?")
    .bind(phone, survey.creator_id)
    .first<{ id: string }>();

  if (existingCreator) {
    // Merge: reassign this survey to the existing creator
    await db
      .prepare("UPDATE surveys SET creator_id = ? WHERE id = ?")
      .bind(existingCreator.id, surveyId)
      .run();
    // Clean up the orphaned anonymous creator
    await db
      .prepare("DELETE FROM creators WHERE id = ? AND phone IS NULL")
      .bind(survey.creator_id)
      .run();
  } else {
    // Update the current creator record with the phone
    await db
      .prepare("UPDATE creators SET phone = ?, wa_name = COALESCE(wa_name, ?) WHERE id = ?")
      .bind(phone, body.name ?? null, survey.creator_id)
      .run();
  }

  // Fetch the API key for the (possibly merged) creator
  const finalCreatorId = existingCreator?.id ?? survey.creator_id;
  const creator = await db
    .prepare("SELECT api_key FROM creators WHERE id = ?")
    .bind(finalCreatorId)
    .first<{ api_key: string | null }>();

  trackServerEvent(finalCreatorId, "creator_phone_claimed", { surveyId, phone });

  return c.json({ ok: true, apiKey: creator?.api_key ?? null });
});

// ── POST /api/auth/login ── Look up creator by verified phone, return API key
surveys.post("/api/auth/login", async (c) => {
  const body = await c.req.json<{ phone: string }>().catch(() => null);
  if (!body?.phone) {
    return c.json({ error: "Phone is required" }, 400);
  }
  const phone = body.phone.replace(/^(\+\d{1,4})0+/, "$1");
  const db = c.env.DB;

  const creator = await db
    .prepare("SELECT id, api_key FROM creators WHERE phone = ?")
    .bind(phone)
    .first<{ id: string; api_key: string | null }>();

  if (!creator) {
    return c.json({ apiKey: null });
  }

  return c.json({ apiKey: creator.api_key, creatorId: creator.id });
});

// ── GET /api/auth/validate ── Validate API key and return creatorId
surveys.get("/api/auth/validate", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) {
    return c.json({ valid: false }, 401);
  }
  return c.json({ valid: true, creatorId });
});

// ── GET /api/my/surveys ── List surveys for authenticated creator
surveys.get("/api/my/surveys", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const db = c.env.DB;

  const rows = await db
    .prepare(
      `SELECT
        s.id,
        s.code,
        s.dashboard_code,
        s.title,
        s.status,
        s.created_at,
        COUNT(DISTINCT sq.id) AS question_count,
        COUNT(DISTINCT CASE WHEN r.status = 'submitted' THEN r.id END) AS response_count,
        COUNT(DISTINCT CASE
          WHEN r.status = 'submitted'
            AND r.submitted_at > COALESCE(csc.last_read_at, '1970-01-01T00:00:00Z')
          THEN r.id
        END) AS new_count,
        MAX(CASE WHEN r.status = 'submitted' THEN r.submitted_at END) AS latest_response_at
      FROM surveys s
      LEFT JOIN survey_questions sq ON sq.survey_id = s.id
      LEFT JOIN responses r ON r.survey_id = s.id
      LEFT JOIN creator_survey_cursors csc ON csc.survey_id = s.id AND csc.creator_id = ?
      WHERE s.creator_id = ? AND s.status != 'deleted'
      GROUP BY s.id
      ORDER BY s.created_at DESC`
    )
    .bind(creatorId, creatorId)
    .all<{
      id: string;
      code: string;
      dashboard_code: string;
      title: string | null;
      status: string;
      created_at: string;
      question_count: number;
      response_count: number;
      new_count: number;
      latest_response_at: string | null;
    }>();

  const surveys_list = rows.results.map((r) => ({
    id: r.id,
    code: r.code,
    dashboardCode: r.dashboard_code,
    title: r.title,
    status: r.status,
    createdAt: r.created_at,
    questionCount: r.question_count,
    responseCount: r.response_count,
    newCount: r.new_count,
    latestResponseAt: r.latest_response_at,
  }));

  return c.json({ surveys: surveys_list });
});

// ── DELETE /api/my/surveys/:id ── Soft-delete a survey (sets status to 'deleted')
surveys.delete("/api/my/surveys/:id", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) return c.json({ error: "Authentication required" }, 401);

  const surveyId = c.req.param("id");
  const db = c.env.DB;

  // Verify the survey belongs to this creator
  const survey = await db
    .prepare("SELECT id FROM surveys WHERE id = ? AND creator_id = ?")
    .bind(surveyId, creatorId)
    .first<{ id: string }>();

  if (!survey) return c.json({ error: "Survey not found" }, 404);

  await db
    .prepare("UPDATE surveys SET status = 'deleted' WHERE id = ?")
    .bind(surveyId)
    .run();

  return c.json({ ok: true });
});

export default surveys;

import { Hono } from "hono";
import type {
  Env,
  CreateSurveyRequest,
  CreateSurveyResponse,
  GenerateSurveyRequest,
  GenerateSurveyResponse,
  BriefEvaluateRequest,
  BriefEvaluateResponse,
  ClarifyRequest,
  ClarifyResponse,
  Clarification,
  TranscribeResponse,
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
  generatePresignedReadUrl,
  generateReadToken,
} from "../services/r2";
import { checkRateLimit } from "../services/ratelimit";
import {
  transcribeAudio,
  generateQuestions,
  generateQuestionsFromBrief,
  generateClarifyingQuestion,
  type GeneratedSurvey,
} from "../services/ai";
import { evaluateBrief, BRIEF_MAX_CHARS } from "../services/brief";
import { trackServerEvent } from "../services/analytics";

/** Longest creator audio we'll transcribe in one go (≈10 min of Opus). */
const MAX_TRANSCRIBE_BYTES = 12 * 1024 * 1024;
/** Most clarifying Q&A pairs we'll feed back into the prompts. */
const MAX_CLARIFICATIONS = 40;
const MAX_CLARIFICATION_CHARS = 4000;

/** Validate and trim a clarifications array from an untrusted body. */
function sanitizeClarifications(input: unknown): Clarification[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (c): c is Clarification =>
        !!c && typeof c === "object" && typeof (c as Clarification).question === "string" && typeof (c as Clarification).answer === "string"
    )
    .map((c) => ({
      question: c.question.trim().slice(0, MAX_CLARIFICATION_CHARS),
      answer: c.answer.trim().slice(0, MAX_CLARIFICATION_CHARS),
    }))
    .filter((c) => c.question && c.answer)
    .slice(0, MAX_CLARIFICATIONS);
}

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

  // Generate upload URLs with one-time tokens: one for the agent-brief
  // recording (current flow) and two for the legacy audience/gather clips.
  const baseUrl = new URL(c.req.url).origin;
  const briefKey = `surveys/${surveyId}/brief.webm`;
  const audienceKey = `surveys/${surveyId}/audience.webm`;
  const gatherKey = `surveys/${surveyId}/gather.webm`;

  const [briefToken, audienceToken, gatherToken] = await Promise.all([
    generateUploadToken(c.env.KV, briefKey),
    generateUploadToken(c.env.KV, audienceKey),
    generateUploadToken(c.env.KV, gatherKey),
  ]);

  const response: CreateSurveyResponse = {
    id: surveyId,
    code,
    dashboardCode,
    apiKey,
    uploadUrls: {
      brief: generatePresignedUploadUrl(baseUrl, briefKey, briefToken),
      audience: generatePresignedUploadUrl(baseUrl, audienceKey, audienceToken),
      gather: generatePresignedUploadUrl(baseUrl, gatherKey, gatherToken),
    },
  };

  trackServerEvent(finalCreatorId, "survey_created", { surveyId, code, dashboardCode });

  return c.json(response, 201);
});

// ── POST /api/surveys/:id/transcribe ── Whisper for a creator recording
// Used by the agent-brief flow when the browser has no usable Web Speech API:
// the frontend posts the audio recorded so far (or a finished answer) and gets
// text back. Body: raw audio bytes (any Content-Type) or multipart with an
// `audio` field.
surveys.post("/api/surveys/:id/transcribe", async (c) => {
  const surveyId = c.req.param("id");
  const survey = await c.env.DB.prepare("SELECT id FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);

  // Rate limit generously: live fallback polls every few seconds.
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "transcribe", ip, 600);
  if (!allowed) return c.json({ error: "Transcription rate limit exceeded" }, 429);

  let buf: ArrayBuffer;
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("audio") as unknown;
    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      return c.json({ error: "Missing audio field" }, 400);
    }
    buf = await (file as Blob).arrayBuffer();
  } else {
    buf = await c.req.arrayBuffer();
  }

  if (buf.byteLength === 0) return c.json({ error: "Empty audio" }, 400);
  if (buf.byteLength > MAX_TRANSCRIBE_BYTES) return c.json({ error: "Audio too large" }, 413);

  const text = await transcribeAudio(c.env.AI, buf, `survey-${surveyId}`);
  const response: TranscribeResponse = { text: (text ?? "").trim() };
  return c.json(response);
});

// ── POST /api/surveys/:id/brief/evaluate ── Which checklist items does the brief cover?
// Called repeatedly (debounced) while the creator talks. TypeSafe Jev answers
// five yes/no questions in ~300 ms; see services/brief.ts for the rubric.
surveys.post("/api/surveys/:id/brief/evaluate", async (c) => {
  const surveyId = c.req.param("id");
  const survey = await c.env.DB.prepare("SELECT id FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "brief-evaluate", ip, 900);
  if (!allowed) return c.json({ error: "Evaluation rate limit exceeded" }, 429);

  const body = await c.req.json<BriefEvaluateRequest>().catch(() => null);
  if (!body || typeof body.transcript !== "string") {
    return c.json({ error: "transcript is required" }, 400);
  }
  if (body.transcript.length > BRIEF_MAX_CHARS) {
    return c.json({ error: "transcript too long" }, 413);
  }

  const evaluation = await evaluateBrief(c.env, body.transcript, `survey-${surveyId}`);
  const response: BriefEvaluateResponse = evaluation;
  return c.json(response);
});

// ── POST /api/surveys/:id/clarify ── Next clarifying question (Cerebras)
// Body: { brief, history: [{question, answer}] }. Stateless: the frontend
// owns the conversation and sends everything so far each time.
surveys.post("/api/surveys/:id/clarify", async (c) => {
  const surveyId = c.req.param("id");
  const survey = await c.env.DB.prepare("SELECT id FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "clarify", ip, 300);
  if (!allowed) return c.json({ error: "Clarify rate limit exceeded" }, 429);

  const body = await c.req.json<ClarifyRequest>().catch(() => null);
  const brief = typeof body?.brief === "string" ? body.brief.trim().slice(0, BRIEF_MAX_CHARS) : "";
  if (!brief) return c.json({ error: "brief is required" }, 400);
  const history = sanitizeClarifications(body?.history);

  const next = await generateClarifyingQuestion(
    c.env.AI,
    c.env.KV,
    { brief, history },
    c.env.CEREBRAS_API_KEY,
    `survey-${surveyId}`
  );

  trackServerEvent(surveyId, "clarify_question_generated", {
    surveyId,
    index: history.length + 1,
  });

  const response: ClarifyResponse = { ...next, index: history.length + 1 };
  return c.json(response);
});

// ── POST /api/surveys/:id/generate ── Generate questions via AI
// Agent brief flow: body { brief, clarifications } (text already transcribed).
// Legacy flow: optional { textAnswers } with R2 audio for whatever is missing.
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

  // Parse optional body
  let body: GenerateSurveyRequest = {};
  try {
    body = await c.req.json<GenerateSurveyRequest>();
    console.log("[generate] Raw request body:", JSON.stringify(body).slice(0, 2000));
  } catch (e) {
    // No body or invalid JSON — fall back to audio-only flow
    console.log("[generate] No request body or invalid JSON, falling back to audio-only:", e);
  }

  const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, BRIEF_MAX_CHARS) : "";
  if (brief) {
    const clarifications = sanitizeClarifications(body.clarifications);
    const generated = await generateQuestionsFromBrief(
      c.env.AI,
      c.env.KV,
      { brief, clarifications },
      c.env.CEREBRAS_API_KEY
    );
    console.log("[generate] Generated from brief:", JSON.stringify(generated));

    await db
      .prepare("UPDATE surveys SET title = ?, brief = ?, brief_clarifications = ? WHERE id = ?")
      .bind(generated.title, brief, JSON.stringify(clarifications), surveyId)
      .run();
    await replaceQuestions(db, surveyId, generated);

    trackServerEvent(surveyId, "survey_questions_generated", {
      surveyId,
      title: generated.title,
      questionCount: generated.questions.length,
      source: "brief",
      clarificationCount: clarifications.length,
    });

    const response: GenerateSurveyResponse = {
      title: generated.title,
      questions: generated.questions,
    };
    return c.json(response);
  }

  const textAnswers = body.textAnswers ?? {};
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

  // 3. Send transcriptions to Cerebras (Workers AI Llama fallback) to generate title + questions
  const generated = await generateQuestions(
    c.env.AI,
    c.env.KV,
    { audience: audienceText, gather: gatherText },
    c.env.CEREBRAS_API_KEY
  );

  console.log("[generate] Generated result:", JSON.stringify(generated));

  // 4. Store title in surveys table and questions in survey_questions
  await db
    .prepare("UPDATE surveys SET title = ? WHERE id = ?")
    .bind(generated.title, surveyId)
    .run();
  await replaceQuestions(db, surveyId, generated);

  trackServerEvent(surveyId, "survey_questions_generated", {
    surveyId,
    title: generated.title,
    questionCount: generated.questions.length,
    source: "legacy",
  });

  // 5. Return the generated data
  const response: GenerateSurveyResponse = {
    title: generated.title,
    questions: generated.questions,
  };

  return c.json(response);
});

/**
 * Replace a survey's questions with a freshly generated set, atomically.
 * Deleting first means "Regenerate" doesn't pile duplicates into the table.
 */
async function replaceQuestions(db: D1Database, surveyId: string, generated: GeneratedSurvey) {
  const deleteStmt = db.prepare("DELETE FROM survey_questions WHERE survey_id = ?").bind(surveyId);
  const inserts = generated.questions.map((q, i) => {
    const qType = q.type === "photo" ? "photo" : q.type === "video" ? "video" : "voice";
    return db
      .prepare(
        "INSERT INTO survey_questions (id, survey_id, sort_order, text, hint, question_type) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(generateId(), surveyId, i + 1, q.text, q.hint ?? null, qType);
  });
  await db.batch([deleteStmt, ...inserts]);
}

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

  // Creator's voice hello — signed read URL, 1h TTL like dashboard audio.
  let intro: SurveyPublicView["intro"] = null;
  if (survey.intro_r2_key) {
    const token = await generateReadToken(c.env.KV, survey.intro_r2_key);
    intro = {
      audioUrl: generatePresignedReadUrl(new URL(c.req.url).origin, survey.intro_r2_key, token),
      durationMs: survey.intro_duration_ms ?? 0,
      transcript: survey.intro_transcript ?? null,
    };
  }

  const view: SurveyPublicView = {
    id: survey.id,
    title: survey.title,
    status: survey.status,
    questions: questions.results,
    audioKeys: audio.results.map((a) => ({
      questionKey: a.question_key,
      audioR2Key: a.audio_r2_key,
    })),
    intro,
  };

  return c.json(view);
});

// ── POST /api/surveys/:id/intro/upload-url ── Fresh presigned URL for the voice intro
//
// The upload URLs minted at survey creation expire after 10 minutes, and the
// intro is recorded at the very end of the flow, so it gets its own token.
surveys.post("/api/surveys/:id/intro/upload-url", async (c) => {
  const surveyId = c.req.param("id");
  const survey = await c.env.DB.prepare("SELECT id FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string }>();
  if (!survey) {
    return c.json({ error: "Survey not found" }, 404);
  }

  const key = introKey(surveyId);
  const token = await generateUploadToken(c.env.KV, key);
  return c.json({
    uploadUrl: generatePresignedUploadUrl(new URL(c.req.url).origin, key, token),
  });
});

// ── PUT /api/surveys/:id/intro ── Record that the intro was uploaded
//
// Body: `{durationMs: number}`. Verifies the object landed in R2, stores the
// key + duration, and transcribes it in the background.
surveys.put("/api/surveys/:id/intro", async (c) => {
  const surveyId = c.req.param("id");
  const db = c.env.DB;

  const survey = await db.prepare("SELECT id FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string }>();
  if (!survey) {
    return c.json({ error: "Survey not found" }, 404);
  }

  const body = await c.req.json<{ durationMs?: number }>().catch(() => ({} as { durationMs?: number }));
  const durationMs =
    typeof body.durationMs === "number" && Number.isFinite(body.durationMs)
      ? Math.max(0, Math.round(body.durationMs))
      : 0;

  const key = introKey(surveyId);
  const head = await c.env.AUDIO_BUCKET.head(key);
  if (!head) {
    return c.json({ error: "Intro audio has not been uploaded yet" }, 409);
  }

  await db
    .prepare(
      "UPDATE surveys SET intro_r2_key = ?, intro_duration_ms = ?, intro_transcript = NULL WHERE id = ?"
    )
    .bind(key, durationMs, surveyId)
    .run();

  trackServerEvent(surveyId, "survey_intro_saved", { surveyId, durationMs });

  // Whisper the intro so it has a text fallback; don't hold up the creator.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const obj = await c.env.AUDIO_BUCKET.get(key);
        if (!obj) return;
        const text = await transcribeAudio(c.env.AI, await obj.arrayBuffer());
        await db
          .prepare("UPDATE surveys SET intro_transcript = ? WHERE id = ? AND intro_r2_key = ?")
          .bind(text.trim() || null, surveyId, key)
          .run();
      } catch (err) {
        console.error("Intro transcription failed", { surveyId, err });
      }
    })()
  );

  return c.json({ success: true, durationMs });
});

// ── DELETE /api/surveys/:id/intro ── Remove the voice intro
surveys.delete("/api/surveys/:id/intro", async (c) => {
  const surveyId = c.req.param("id");
  const key = introKey(surveyId);
  await Promise.all([
    c.env.AUDIO_BUCKET.delete(key).catch(() => {}),
    c.env.DB.prepare(
      "UPDATE surveys SET intro_r2_key = NULL, intro_duration_ms = NULL, intro_transcript = NULL WHERE id = ?"
    )
      .bind(surveyId)
      .run(),
  ]);
  return c.json({ success: true });
});

function introKey(surveyId: string) {
  return `surveys/${surveyId}/intro.webm`;
}

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

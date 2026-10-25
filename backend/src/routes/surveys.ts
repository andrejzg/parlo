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
import { buildShareUrl, extractCode } from "../services/slug";
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
  generateReplacementQuestion,
  adjustQuestions, reviseQuestions,
  isAdjustKind,
  type GeneratedSurvey,
} from "../services/ai";
import { evaluateBrief, BRIEF_MAX_CHARS } from "../services/brief";
import { closesAtFor, composeBrief, isAudienceId, isLengthId, isShapeId, resolveTiming, TOPIC_MAX_CHARS, type TimingId } from "../services/shapes";
import { sanitizeOutputs } from "../services/outputs";
import { OPENER_TOKEN_TTL_SECONDS, introKey, openerTokenKey, saveIntroFromUrl } from "../services/intro";
import { buildBotChatUrl } from "../services/whatsapp";
import { trackServerEvent } from "../services/analytics";
import type { AuthVariables } from "../middleware/auth";
import { claimOwnership, claimOwnershipForUser, displayNameFor, ensureApiKey, ensureMember, findUserByPhone, getMemberByToken, normalizePhone, upsertUserByPhone } from "../services/groups";
import { PhoneProofError, resolveVerifiedPhone } from "../services/phoneProof";
import { ensureRound1, latestSentRound, pendingAsksFor, setRoundClosesAt } from "../services/rounds";
import { getAgentByName } from "agents";
import {
  batchAll,
  facesStmt,
  latestOf,
  openRoundStmt,
  proposedRoundStmt,
  reportPreview,
  toFace,
  toIso,
  type FaceRow,
  type OpenRoundRow,
  type ProposedRoundRow,
} from "../services/home";

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

const surveys = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

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

  // One identity table: find or create the owner (anonymous until they verify a phone).
  // An API key (an agent acting for its person, the MCP server, a verified
  // device) makes that user the owner outright, so the parlo shows up in
  // their home list and `list_my_surveys` without a claim step.
  let finalCreatorId: string;
  const authedUserId = c.get("userId");
  const creatorPhone = body.creatorPhone ? normalizePhone(body.creatorPhone) : null;
  if (authedUserId) {
    finalCreatorId = authedUserId;
  } else if (creatorPhone) {
    const existing = await findUserByPhone(db, creatorPhone);
    if (existing) {
      finalCreatorId = existing.id;
    } else {
      finalCreatorId = generateId();
      await db
        .prepare("INSERT INTO users (id, phone, wa_name) VALUES (?, ?, ?)")
        .bind(finalCreatorId, creatorPhone, body.creatorName ?? null)
        .run();
    }
  } else {
    finalCreatorId = generateId();
    await db.prepare("INSERT INTO users (id) VALUES (?)").bind(finalCreatorId).run();
  }

  // Create the parlo. Private by default: only the owner, admins and the
  // agent hear raw answers; every member gets the agent's report.
  const surveyId = generateId();
  const code = generateCode(8);
  const dashboardCode = generateCode(12);

  await db
    .prepare(
      "INSERT INTO surveys (id, code, dashboard_code, creator_id, title, visibility) VALUES (?, ?, ?, ?, ?, 'private')"
    )
    .bind(surveyId, code, dashboardCode, finalCreatorId, body.title ?? null)
    .run();
  await ensureMember(db, surveyId, finalCreatorId, "owner");
  await ensureRound1(db, surveyId);

  // Generate or retrieve the owner's API key
  const existingCreator = await db
    .prepare("SELECT api_key FROM users WHERE id = ?")
    .bind(finalCreatorId)
    .first<{ api_key: string | null }>();

  let apiKey = existingCreator?.api_key;
  if (!apiKey) {
    apiKey = `pk_${generateCode(32)}`;
    await db
      .prepare("UPDATE users SET api_key = ? WHERE id = ?")
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

  trackServerEvent(finalCreatorId, "survey_created", { surveyId, code, dashboardCode, viaApiKey: !!authedUserId });

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

/** The draft on the review screen, as the swap and adjust routes read it from an untrusted body. */
function draftFromBody(input: unknown): { text: string; hint?: string; type: string }[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((q): q is { text: string; hint?: unknown; type?: unknown } => !!q && typeof q === "object" && typeof (q as { text?: unknown }).text === "string")
    .slice(0, 20)
    .map((q) => ({
      text: q.text.trim().slice(0, 500),
      hint: typeof q.hint === "string" ? q.hint.slice(0, 80) : undefined,
      type: typeof q.type === "string" ? q.type : "voice",
    }))
    .filter((q) => q.text.length > 0);
}

// ── POST /api/surveys/:id/questions/adjust ── Rewrite the whole draft in place
// Review-screen chips. Body: { kind: "shorter" | "playful", questions: [{text, hint?, type?}] }.
// Same count, order and media type back, only the wording changed. Nothing
// is saved; the review screen persists with PUT /questions on confirm.
surveys.post("/api/surveys/:id/questions/adjust", async (c) => {
  const surveyId = c.req.param("id");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "question-adjust", ip, 300);
  if (!allowed) return c.json({ error: "Too many requests" }, 429);

  const survey = await c.env.DB.prepare("SELECT brief FROM surveys WHERE id = ?").bind(surveyId).first<{ brief: string | null }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);

  const body = await c.req.json<{ kind?: unknown; questions?: unknown }>().catch(() => ({}) as { kind?: unknown; questions?: unknown });
  if (!isAdjustKind(body.kind)) return c.json({ error: "unknown kind" }, 400);
  const questions = draftFromBody(body.questions);
  if (questions.length === 0) return c.json({ error: "questions are required" }, 400);

  const adjusted = await adjustQuestions(
    c.env.AI,
    c.env.CEREBRAS_API_KEY,
    { brief: survey.brief?.trim() || "(no brief)", kind: body.kind, questions },
    `survey-${surveyId}`
  );
  trackServerEvent(surveyId, "survey_questions_adjusted", { surveyId, kind: body.kind, questionCount: questions.length });
  return c.json({ questions: adjusted });
});

// ── POST /api/surveys/:id/questions/revise ── The draft edited with the follow-up answers
// The checkpoint after "Sharpen it". Body: { questions: [{text, hint?, type?}],
// clarifications: [{question, answer}] }. Questions may be reworded, dropped,
// added or reordered (count within two of the draft). The clarifications are
// persisted to brief_clarifications so the agent and /swap see them. Nothing
// else is saved; the review screen persists with PUT /questions on confirm.
surveys.post("/api/surveys/:id/questions/revise", async (c) => {
  const surveyId = c.req.param("id");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "question-revise", ip, 300);
  if (!allowed) return c.json({ error: "Too many requests" }, 429);

  const survey = await c.env.DB.prepare("SELECT brief FROM surveys WHERE id = ?").bind(surveyId).first<{ brief: string | null }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);

  const body = await c.req
    .json<{ questions?: unknown; clarifications?: unknown }>()
    .catch(() => ({}) as { questions?: unknown; clarifications?: unknown });
  const questions = draftFromBody(body.questions);
  if (questions.length === 0) return c.json({ error: "questions are required" }, 400);
  const clarifications = sanitizeClarifications(body.clarifications);
  if (clarifications.length === 0) return c.json({ error: "clarifications are required" }, 400);

  const revised = await reviseQuestions(
    c.env.AI,
    c.env.CEREBRAS_API_KEY,
    { brief: survey.brief?.trim() || "(no brief)", clarifications, questions },
    `survey-${surveyId}`
  );
  await c.env.DB.prepare("UPDATE surveys SET brief_clarifications = ? WHERE id = ?").bind(JSON.stringify(clarifications), surveyId).run();
  trackServerEvent(surveyId, "survey_questions_revised", {
    surveyId,
    clarificationCount: clarifications.length,
    before: questions.length,
    after: revised.length,
  });
  return c.json({ questions: revised });
});

// ── POST /api/surveys/:id/questions/swap ── One different question for a slot
// Review-screen fidget. Body: { index, questions: [{text, type?}] } — the
// draft on screen. Nothing is saved here; the review screen persists the
// whole list with PUT /questions on confirm. Works from the brief stored by
// /generate, so it needs a generate first.
surveys.post("/api/surveys/:id/questions/swap", async (c) => {
  const surveyId = c.req.param("id");
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "question-swap", ip, 300);
  if (!allowed) return c.json({ error: "Too many requests" }, 429);

  const survey = await c.env.DB.prepare("SELECT brief, brief_clarifications FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ brief: string | null; brief_clarifications: string | null }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);
  if (!survey.brief?.trim()) return c.json({ error: "This parlo has no brief to work from yet" }, 400);

  const body = await c.req.json<{ index?: unknown; questions?: unknown }>().catch(() => ({} as { index?: unknown; questions?: unknown }));
  const questions = draftFromBody(body.questions);
  const index = typeof body.index === "number" ? Math.floor(body.index) : -1;
  if (questions.length === 0 || index < 0 || index >= questions.length) {
    return c.json({ error: "index and questions are required" }, 400);
  }

  let clarifications: Clarification[] = [];
  try {
    clarifications = sanitizeClarifications(JSON.parse(survey.brief_clarifications ?? "[]"));
  } catch {
    clarifications = [];
  }

  const question = await generateReplacementQuestion(
    c.env.AI,
    c.env.CEREBRAS_API_KEY,
    { brief: survey.brief, clarifications, questions, index },
    `survey-${surveyId}`
  );
  trackServerEvent(surveyId, "survey_question_swapped", { surveyId, index, questionCount: questions.length });
  return c.json({ question });
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

  // Output-first flow: the brief is composed from the taps and the one blank.
  // "Something else" sends a free-form brief instead; the legacy flow neither.
  let brief = "";
  let outputShape: string | null = null;
  let audienceKind: string | null = null;
  let lengthKind: string | null = null;
  let timing: TimingId | null = null;
  const outputs = sanitizeOutputs(body.outputs);
  if (typeof body.shape === "string" && body.shape !== "other") {
    if (!isShapeId(body.shape) || body.shape === "other") return c.json({ error: "unknown shape" }, 400);
    // Optional since 2026-10-25 (the screen is taps only); kept for older clients and the API.
    const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, TOPIC_MAX_CHARS) : "";
    const audience = isAudienceId(body.audience) ? body.audience : "group";
    const length = isLengthId(body.length) ? body.length : "few";
    timing = resolveTiming(body.shape, body.timing);
    brief = composeBrief({ shape: body.shape, audience, length, topic, outputs, timing });
    outputShape = body.shape;
    audienceKind = audience;
    lengthKind = length;
  } else if (typeof body.brief === "string") {
    brief = body.brief.trim().slice(0, BRIEF_MAX_CHARS);
    if (brief) outputShape = "other";
  }

  if (brief) {
    const clarifications = sanitizeClarifications(body.clarifications);
    const generated = await generateQuestionsFromBrief(c.env.AI, c.env.KV, { brief, clarifications }, c.env.CEREBRAS_API_KEY);
    console.log("[generate] Generated from brief:", JSON.stringify(generated));

    await db
      .prepare(
        "UPDATE surveys SET title = ?, brief = ?, brief_clarifications = ?, output_shape = ?, audience_kind = ?, outputs = ?, timing = ? WHERE id = ?"
      )
      .bind(generated.title, brief, JSON.stringify(clarifications), outputShape, audienceKind, JSON.stringify(outputs), timing, surveyId)
      .run();
    await replaceQuestions(db, surveyId, generated);
    // The build is go-live since 2026-10-25 (no review screen): a timed
    // parlo's round 1 closes `timing` from now and the agent holds the alarms.
    await scheduleRound1Close(c, surveyId);

    trackServerEvent(surveyId, "survey_questions_generated", {
      surveyId,
      title: generated.title,
      questionCount: generated.questions.length,
      source: outputShape && outputShape !== "other" ? "shape" : "brief",
      shape: outputShape,
      audience: audienceKind,
      length: lengthKind,
      outputs,
      outputCount: outputs.length,
      timing,
      clarificationCount: clarifications.length,
    });

    const response: GenerateSurveyResponse = {
      title: generated.title,
      questions: generated.questions,
      brief,
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

  // 5. Return the generated data (the legacy flow keeps no brief)
  const response: GenerateSurveyResponse = {
    title: generated.title,
    questions: generated.questions,
    brief: "",
  };

  return c.json(response);
});

/**
 * Go-live for a timed parlo: round 1 closes `surveys.timing` from now and the
 * agent holds the alarms (a nudge before, the close at it); the row holds the
 * date. A parlo with no deadline clears it.
 */
async function scheduleRound1Close(c: { env: Env; executionCtx: { waitUntil(promise: Promise<unknown>): void } }, surveyId: string) {
  const db = c.env.DB;
  const round1 = await ensureRound1(db, surveyId);
  const timed = await db.prepare("SELECT timing FROM surveys WHERE id = ?").bind(surveyId).first<{ timing: string | null }>();
  const closesAt = closesAtFor(timed?.timing);
  await setRoundClosesAt(db, round1.id, closesAt);
  if (!closesAt) return;
  c.executionCtx.waitUntil(
    getAgentByName(c.env.GROUP_AGENT, surveyId)
      .then((agent) => agent.scheduleClose(surveyId, round1.id, closesAt.toISOString()))
      .catch((err) => console.error("[generate] scheduleClose failed", err))
  );
}

/**
 * Replace a survey's questions with a freshly generated set, atomically.
 * Deleting first means "Regenerate" doesn't pile duplicates into the table.
 */
async function replaceQuestions(db: D1Database, surveyId: string, generated: GeneratedSurvey) {
  // Only round 1 (the original set) is replaced; later rounds are the agent's.
  const round1 = await ensureRound1(db, surveyId);
  const deleteStmt = db
    .prepare("DELETE FROM survey_questions WHERE survey_id = ? AND (round_id = ? OR round_id IS NULL)")
    .bind(surveyId, round1.id);
  const inserts = generated.questions.map((q, i) => {
    const qType = q.type === "photo" ? "photo" : q.type === "video" ? "video" : "voice";
    return db
      .prepare(
        "INSERT INTO survey_questions (id, survey_id, sort_order, text, hint, question_type, round_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(generateId(), surveyId, i + 1, q.text, q.hint ?? null, qType, round1.id);
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

  // Atomically replace round 1's questions (later rounds belong to the agent)
  const round1 = await ensureRound1(db, surveyId);
  const deleteStmt = db
    .prepare("DELETE FROM survey_questions WHERE survey_id = ? AND (round_id = ? OR round_id IS NULL)")
    .bind(surveyId, round1.id);
  const insertStmts = body.questions.map((q, i) => {
    const qId = generateId();
    const qType = q.type === "photo" ? "photo" : q.type === "video" ? "video" : "voice";
    return db
      .prepare(
        "INSERT INTO survey_questions (id, survey_id, sort_order, text, hint, question_type, round_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(qId, surveyId, i + 1, q.text, q.hint ?? null, qType, round1.id);
  });
  await db.batch([deleteStmt, ...insertStmts]);
  // An API caller editing round 1 after the build: the deadline restarts from now.
  await scheduleRound1Close(c, surveyId);

  // Fetch the inserted questions to return them
  const updated = await db
    .prepare(
      "SELECT * FROM survey_questions WHERE survey_id = ? AND round_id = ? ORDER BY sort_order"
    )
    .bind(surveyId, round1.id)
    .all<SurveyQuestion>();

  trackServerEvent(surveyId, "survey_questions_updated", {
    surveyId,
    questionCount: body.questions.length,
  });

  return c.json({ questions: updated.results });
});

// ── GET /api/s/:code ── Get survey for participant
//
// `?t=<member token>` personalises it: the questions become the asks still
// pending for that member (including probes aimed at them) and, once they
// have answered at least once, the agent's report is unlocked.
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

  const member = await getMemberByToken(db, survey.id, c.req.query("t"));
  const [questions, round, memberCountRow] = await Promise.all([
    pendingAsksFor(db, survey.id, member?.user_id ?? null),
    latestSentRound(db, survey.id),
    db.prepare("SELECT COUNT(*) AS n FROM group_members WHERE survey_id = ? AND removed_at IS NULL").bind(survey.id).first<{ n: number }>(),
  ]);

  let memberView: SurveyPublicView["member"] = null;
  let hasAnswered = false;
  if (member) {
    const user = await db
      .prepare("SELECT first_name, last_name, wa_name, linkedin_name, phone FROM users WHERE id = ?")
      .bind(member.user_id)
      .first<{ first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null }>();
    const answered = await db
      .prepare("SELECT 1 FROM responses WHERE survey_id = ? AND user_id = ? AND status != 'in_progress' LIMIT 1")
      .bind(survey.id, member.user_id)
      .first();
    hasAnswered = !!answered;
    memberView = { role: member.role, displayName: user ? displayNameFor(user) : null, hasAnswered };
  }
  const unlocked = !!member && (hasAnswered || member.role === "owner" || member.role === "admin");

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
    questions,
    audioKeys: [],
    intro,
    visibility: survey.visibility === "open" ? "open" : "private",
    round: round ? { number: round.number, kind: round.kind, closesAt: round.closes_at ?? null } : null,
    member: memberView,
    report: {
      available: !!survey.report_md,
      unlocked,
      markdown: unlocked ? survey.report_md ?? null : null,
      updatedAt: survey.report_updated_at ?? null,
    },
    memberCount: memberCountRow?.n ?? 0,
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

// ── POST /api/surveys/:id/intro/from-url ── Fetch the opener from a URL
//
// For agents (the MCP server, an owner's personal agent) that hold the
// creator's voice note as a URL rather than as bytes in a browser. Body:
// `{url}` (https). The Worker fetches it (12 MB cap, audio or video content
// type), stores it under the intro key, transcribes it with Whisper *before*
// answering so the transcript can be the brief, and takes the duration from
// Whisper's word timings. Owner only: the Worker fetches whatever URL it is
// given, so the caller has to be the person the parlo belongs to.
surveys.post("/api/surveys/:id/intro/from-url", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const surveyId = c.req.param("id");
  const survey = await c.env.DB
    .prepare("SELECT id FROM surveys WHERE id = ? AND creator_id = ?")
    .bind(surveyId, userId)
    .first<{ id: string }>();
  if (!survey) return c.json({ error: "Survey not found" }, 404);

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "intro-from-url", ip, 60);
  if (!allowed) return c.json({ error: "Rate limit exceeded" }, 429);

  const body = await c.req.json<{ url?: unknown }>().catch(() => ({} as { url?: unknown }));
  const result = await saveIntroFromUrl(c.env, surveyId, body.url);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ success: true, ...result.saved });
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

// ── POST /api/surveys/:id/claim ── Attach a verified identity to the parlo's owner seat
//
// Proof is mandatory: an API key (a device that passed OTP before), a Firebase
// ID token or a WhatsApp proof token (see services/phoneProof.ts). A phone
// number in the body proves nothing and is not read. A parlo whose owner is
// already a verified user can only be re-claimed by that same user.
surveys.post("/api/surveys/:id/claim", async (c) => {
  return claimSurveyAs(c, c.req.param("id"));
});

// ── GET/POST /api/claim/:token ── The claim link an agent hands its person
//
// `POST /api/agent/parlos` mints `claim:{token}` → surveyId in KV (7 days)
// when the owner is anonymous. GET shows what is being claimed; POST takes
// the same proof as `/claim` (API key, Firebase ID token or WhatsApp proof),
// attaches the parlo to that person and burns the token.
surveys.get("/api/claim/:token", async (c) => {
  const surveyId = await c.env.KV.get(claimKey(c.req.param("token")));
  if (!surveyId) return c.json({ error: "This claim link has expired" }, 404);
  const survey = await c.env.DB
    .prepare("SELECT s.title, s.code, u.phone FROM surveys s JOIN users u ON u.id = s.creator_id WHERE s.id = ?")
    .bind(surveyId)
    .first<{ title: string | null; code: string; phone: string | null }>();
  if (!survey) return c.json({ error: "This claim link has expired" }, 404);
  return c.json({ title: survey.title, code: survey.code, alreadyClaimed: !!survey.phone });
});

surveys.post("/api/claim/:token", async (c) => {
  const token = c.req.param("token");
  const surveyId = await c.env.KV.get(claimKey(token));
  if (!surveyId) return c.json({ error: "This claim link has expired" }, 404);
  const res = await claimSurveyAs(c, surveyId);
  if (res.status === 200) await c.env.KV.delete(claimKey(token));
  return res;
});

function claimKey(token: string) {
  return `claim:${token}`;
}

const CLAIM_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

type ClaimContext = {
  env: Env;
  req: { json<T>(): Promise<T> };
  get(key: "userId"): string | null;
  json: (body: unknown, status?: 200 | 403 | 404 | 400 | 401 | 409 | 429 | 500) => Response;
};

async function claimSurveyAs(c: ClaimContext, surveyId: string): Promise<Response> {
  const db = c.env.DB;
  type ClaimBody = { idToken?: string; proof?: string; name?: string };
  const body = await c.req.json<ClaimBody>().catch((): ClaimBody => ({}));

  const survey = await db
    .prepare("SELECT id, creator_id, dashboard_code FROM surveys WHERE id = ?")
    .bind(surveyId)
    .first<{ id: string; creator_id: string; dashboard_code: string }>();
  if (!survey) {
    return c.json({ error: "Survey not found" }, 404);
  }
  const owner = await db.prepare("SELECT id, phone FROM users WHERE id = ?").bind(survey.creator_id).first<{ id: string; phone: string | null }>();

  let finalCreatorId: string;
  let method: string;
  const callerId = c.get("userId");
  if (callerId) {
    if (owner?.phone && owner.id !== callerId) return c.json({ error: "This parlo already belongs to someone else" }, 403);
    finalCreatorId = await claimOwnershipForUser(db, surveyId, survey.creator_id, callerId);
    method = "api_key";
  } else {
    let phone: string;
    try {
      const verified = await resolveVerifiedPhone(c.env, body);
      phone = verified.phone;
      method = verified.method;
    } catch (err) {
      if (err instanceof PhoneProofError) return c.json({ error: err.message, code: err.code }, err.status as 400 | 401);
      throw err;
    }
    if (owner?.phone && owner.phone !== phone) return c.json({ error: "This parlo already belongs to someone else" }, 403);
    finalCreatorId = await claimOwnership(db, surveyId, survey.creator_id, phone, body.name ?? null);
  }

  const apiKey = await ensureApiKey(db, finalCreatorId);
  const user = await db.prepare("SELECT phone FROM users WHERE id = ?").bind(finalCreatorId).first<{ phone: string | null }>();
  trackServerEvent(finalCreatorId, "creator_phone_claimed", { surveyId, method });

  return c.json({ ok: true, apiKey, userId: finalCreatorId, phone: user?.phone ?? null, dashboardCode: survey.dashboard_code });
}

// ── POST /api/agent/parlos ── One call, for agents: brief in, live link out
//
// What parlo.me tells an AI agent to do instead of driving the UI (the static
// block in frontend/index.html and /llms.txt). Body `{brief?, opener_audio_url?,
// title?}`, at least one of the first two. With an API key the caller's user
// owns the parlo; without one the owner is a fresh anonymous user and the
// answer carries a `claimLink` the agent hands to its person, plus the
// `apiKey` to send next time. Rate limited 30/hr per IP on top of the
// creation limit, because every call pays for a model run.
surveys.post("/api/agent/parlos", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const [createAllowed, agentAllowed] = await Promise.all([
    checkRateLimit(c.env.KV, "survey-create", ip, 100),
    checkRateLimit(c.env.KV, "agent-create", ip, 30),
  ]);
  if (!createAllowed || !agentAllowed) return c.json({ error: "Rate limit exceeded. Try again in an hour." }, 429);

  type AgentBody = { brief?: unknown; opener_audio_url?: unknown; title?: unknown };
  const body = await c.req.json<AgentBody>().catch((): AgentBody => ({}));
  const typedBrief = typeof body.brief === "string" ? body.brief.trim().slice(0, BRIEF_MAX_CHARS) : "";
  const openerUrl = typeof body.opener_audio_url === "string" ? body.opener_audio_url.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) || null : null;
  if (!typedBrief && !openerUrl) {
    return c.json({ error: "Send a brief (what to ask the group and why, in the person's own words) or an opener_audio_url, or both." }, 400);
  }

  const db = c.env.DB;
  const authedUserId = c.get("userId");
  let ownerId = authedUserId;
  if (!ownerId) {
    ownerId = generateId();
    await db.prepare("INSERT INTO users (id) VALUES (?)").bind(ownerId).run();
  }
  const apiKey = await ensureApiKey(db, ownerId);

  const surveyId = generateId();
  const code = generateCode(8);
  const dashboardCode = generateCode(12);
  await db
    .prepare("INSERT INTO surveys (id, code, dashboard_code, creator_id, title, visibility) VALUES (?, ?, ?, ?, ?, 'private')")
    .bind(surveyId, code, dashboardCode, ownerId, title)
    .run();
  await ensureMember(db, surveyId, ownerId, "owner");
  await ensureRound1(db, surveyId);
  trackServerEvent(ownerId, "survey_created", { surveyId, code, dashboardCode, viaApiKey: !!authedUserId, via: "agent" });

  let opener: { durationMs: number; transcript: string } | null = null;
  let openerError: string | null = null;
  if (openerUrl) {
    const result = await saveIntroFromUrl(c.env, surveyId, openerUrl);
    if (result.ok) opener = { durationMs: result.saved.durationMs, transcript: result.saved.transcript };
    else openerError = result.error;
  }

  const transcript = opener?.transcript.trim() ?? "";
  if (!typedBrief && !transcript) {
    return c.json(
      {
        error: openerError
          ? `Could not use the voice note (${openerError}) and no brief was given. Send the brief as text, or a URL this server can fetch.`
          : "The voice note had no usable words and no brief was given. Send the brief as text.",
        parloId: surveyId,
      },
      400
    );
  }
  const brief = typedBrief || transcript || FALLBACK_BRIEF;
  const briefSource = typedBrief ? "brief" : transcript ? "opener_transcript" : "fallback";

  const generated = await generateQuestionsFromBrief(c.env.AI, c.env.KV, { brief, clarifications: [] }, c.env.CEREBRAS_API_KEY);
  await db
    .prepare("UPDATE surveys SET title = ?, brief = ?, brief_clarifications = '[]', output_shape = 'other', outputs = '[]' WHERE id = ?")
    .bind(title ?? generated.title, brief, surveyId)
    .run();
  await replaceQuestions(db, surveyId, generated);
  await scheduleRound1Close(c, surveyId);

  const finalTitle = title ?? generated.title;
  const origin = c.env.FRONTEND_ORIGIN || "https://parlo.me";
  const shareLink = buildShareUrl(finalTitle, code, origin);

  let claimLink: string | null = null;
  if (!authedUserId) {
    const token = generateCode(24);
    await c.env.KV.put(claimKey(token), surveyId, { expirationTtl: CLAIM_TOKEN_TTL_SECONDS });
    claimLink = `${origin}/claim/${token}`;
  }

  trackServerEvent(surveyId, "survey_questions_generated", {
    surveyId,
    title: finalTitle,
    questionCount: generated.questions.length,
    source: "brief",
    via: "agent",
    briefSource,
    hasOpener: !!opener,
    userAgent: (c.req.header("user-agent") ?? "").slice(0, 120),
  });

  const whatsappText = encodeURIComponent(`Hey! I'd love to hear your thoughts. It takes 2 minutes, just tap and talk: ${shareLink}`);

  // The opener by WhatsApp: a deep link into a chat with Parlo's number with
  // "opener <code> <token>" prefilled. The person taps it and sends a voice
  // note; the webhook stores it as the opener and, the number being proof,
  // claims the parlo for them. Agents relay links where they drop asks.
  const openerToken = generateCode(24);
  await c.env.KV.put(openerTokenKey(openerToken), surveyId, { expirationTtl: OPENER_TOKEN_TTL_SECONDS });
  const openerLink = buildBotChatUrl(`opener ${code} ${openerToken}`);
  const openerRequest = opener
    ? null
    : {
        why: "The opener is the voice note the group hears before they answer: the person, in their own voice, saying why they are asking. Parlos with one get answered; a link with no voice is a form.",
        link: openerLink,
        askThePerson: `${OPENER_ASK} Tap this and send it to Parlo on WhatsApp: ${openerLink}`,
        alternatively: `If you hold the voice note as a file URL yourself: POST https://api.parlo.me/api/surveys/${surveyId}/intro/from-url with header X-Parlo-Api-Key: ${apiKey} and body {"url": "<https URL>"}.`,
      };
  return c.json(
    {
      parloId: surveyId,
      code,
      title: finalTitle,
      shareLink,
      whatsappShareLink: `https://wa.me/?text=${whatsappText}`,
      dashboardLink: `${origin}/d/${dashboardCode}`,
      claimLink,
      openerLink,
      apiKey,
      questions: generated.questions,
      briefSource,
      opener,
      openerError,
      openerRequest,
      // Ordered: agents relay these as steps. The voice-note ask comes
      // second on purpose, before the claim link, so it is not the bit
      // that gets dropped from a short reply.
      next: [
        `1. Post shareLink into the group chat. The parlo is live; anyone who opens it answers by voice.`,
        openerRequest
          ? `2. Send the person openerLink (${openerLink}) with these words: "${OPENER_ASK}" They tap it and send the voice note to Parlo on WhatsApp; nothing else to do. The group hears it before they answer.`
          : `2. The opener is in place; the group hears it before they answer.`,
        claimLink
          ? `3. Send claimLink to the person: one tap (and a phone code the first time) makes the parlo theirs, with the report and the dashboard.`
          : `3. The parlo belongs to the API key's owner; the dashboard is at dashboardLink.`,
        `4. Keep apiKey and send it as the X-Parlo-Api-Key header next time, so new parlos are theirs from the start.`,
      ],
    },
    201
  );
});

/** What an agent should ask its person for; the three prompts are the web opener screen's. */
const OPENER_ASK =
  "Record a voice note of 30 to 60 seconds, as if you were talking to the group: who you are, what you want to hear from them, and what you will do with it. They hear it before they answer.";

/** What the web opener falls back to when the creator said nothing usable (mirrors CreatorPage). */
const FALLBACK_BRIEF =
  "A short voice conversation with my group. Ask them, in a warm and direct way, what is on their mind about the thing I opened with, what they would change, and what they need from me. Four questions.";

// ── POST /api/auth/login ── Prove a phone, get the user's API key
//
// Body: {idToken} (Firebase, after the SMS code was confirmed in the browser)
// or {proof} (from POST /api/otp/verify-whatsapp), optionally with
// firstName/lastName. Creates the user if the phone is new and mints an API
// key if they have none, so members who joined by answering can log in too.
surveys.post("/api/auth/login", async (c) => {
  type LoginBody = { idToken?: string; proof?: string; firstName?: string; lastName?: string };
  const body = await c.req.json<LoginBody>().catch((): LoginBody => ({}));
  let phone: string;
  let method: string;
  try {
    const verified = await resolveVerifiedPhone(c.env, body);
    phone = verified.phone;
    method = verified.method;
  } catch (err) {
    if (err instanceof PhoneProofError) return c.json({ error: err.message, code: err.code }, err.status);
    throw err;
  }
  const db = c.env.DB;
  const user = await upsertUserByPhone(db, phone, { firstName: body.firstName ?? null, lastName: body.lastName ?? null });
  const apiKey = await ensureApiKey(db, user.id);
  trackServerEvent(user.id, "user_logged_in", { method, created: user.created });

  return c.json({ apiKey, userId: user.id, creatorId: user.id, phone, created: user.created });
});

// ── GET /api/auth/validate ── Validate API key and return creatorId
surveys.get("/api/auth/validate", async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ valid: false }, 401);
  }
  return c.json({ valid: true, creatorId: userId, userId });
});

// ── GET /api/my/surveys ── Every parlo the authenticated user is in, with their role
// ── GET /api/my/surveys ── Every parlo you're in, shaped for the home
// screen's chat-style list: newest activity first, each row carrying the
// open round and how many answered it, any proposal waiting on the owner, a
// few faces for the avatar cluster, and the first line of the agent's report.
surveys.get("/api/my/surveys", async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const db = c.env.DB;
  const baseUrl = new URL(c.req.url).origin;

  const rows = await db
    .prepare(
      `SELECT
        s.id,
        s.code,
        s.dashboard_code,
        s.title,
        s.status,
        s.visibility,
        s.created_at,
        s.report_updated_at,
        substr(s.report_md, 1, 2000) AS report_head,
        gm.role,
        gm.access_token,
        (SELECT COUNT(*) FROM survey_questions sq WHERE sq.survey_id = s.id) AS question_count,
        (SELECT COUNT(*) FROM group_members m WHERE m.survey_id = s.id AND m.removed_at IS NULL) AS member_count,
        COUNT(DISTINCT CASE WHEN r.status != 'in_progress' THEN r.id END) AS response_count,
        COUNT(DISTINCT CASE
          WHEN r.status != 'in_progress'
            AND r.submitted_at > COALESCE(csc.last_read_at, '1970-01-01T00:00:00Z')
          THEN r.id
        END) AS new_count,
        MAX(CASE WHEN r.status != 'in_progress' THEN r.submitted_at END) AS latest_response_at
      FROM group_members gm
      JOIN surveys s ON s.id = gm.survey_id
      LEFT JOIN responses r ON r.survey_id = s.id
      LEFT JOIN creator_survey_cursors csc ON csc.survey_id = s.id AND csc.creator_id = ?
      WHERE gm.user_id = ? AND gm.removed_at IS NULL AND s.status != 'deleted'
      GROUP BY s.id`
    )
    .bind(userId, userId)
    .all<{
      id: string;
      code: string;
      dashboard_code: string;
      title: string | null;
      status: string;
      visibility: string;
      created_at: string;
      report_updated_at: string | null;
      report_head: string | null;
      role: "owner" | "admin" | "member";
      access_token: string;
      question_count: number;
      member_count: number;
      response_count: number;
      new_count: number;
      latest_response_at: string | null;
    }>();

  if (rows.results.length === 0) return c.json({ surveys: [] });

  // Three statements per parlo, one round trip: open round, proposal, faces.
  const detail = await batchAll(
    db,
    rows.results.flatMap((s) => [openRoundStmt(db, s.id), proposedRoundStmt(db, s.id), facesStmt(db, s.id, userId)])
  );

  const surveys_list = await Promise.all(
    rows.results.map(async (r, i) => {
      const open = detail[i * 3].results[0] as unknown as OpenRoundRow | undefined;
      const proposed = detail[i * 3 + 1].results[0] as unknown as ProposedRoundRow | undefined;
      const faces = (detail[i * 3 + 2].results as unknown as FaceRow[]).map((f) => toFace(f, baseUrl));
      const manager = r.role !== "member";
      // Owners and admins never answered round 1 themselves, so "pending asks"
      // would always be non-zero for them; the signal only means something
      // for members.
      const pendingAsks = manager ? 0 : (await pendingAsksFor(db, r.id, userId)).length;

      const round = open
        ? {
            number: open.number,
            kind: open.kind,
            sentAt: toIso(open.sent_at),
            closesAt: open.closes_at ?? null,
            answered: open.answered,
            // A poll reaches every member but the owner, who asked it; a probe
            // reaches the members it was aimed at.
            targets: open.kind === "probe" ? open.targeted : Math.max(0, r.member_count - 1),
          }
        : null;

      const lastActivityAt =
        latestOf([
          r.created_at,
          r.latest_response_at,
          r.report_updated_at,
          // Round 1 is sent the moment the parlo is created; only later rounds are news.
          open && open.number > 1 ? open.sent_at : null,
          manager && proposed ? proposed.created_at : null,
        ]) ?? new Date().toISOString();

      return {
        id: r.id,
        code: r.code,
        // Members never see the dashboard code; it would let them read raw answers.
        dashboardCode: manager ? r.dashboard_code : "",
        title: r.title,
        status: r.status,
        visibility: r.visibility === "open" ? "open" : "private",
        createdAt: toIso(r.created_at) ?? r.created_at,
        role: r.role,
        memberToken: r.access_token,
        questionCount: r.question_count,
        memberCount: r.member_count,
        responseCount: r.response_count,
        newCount: manager ? r.new_count : 0,
        latestResponseAt: toIso(r.latest_response_at),
        reportUpdatedAt: toIso(r.report_updated_at),
        reportPreview: reportPreview(r.report_head),
        lastActivityAt,
        round,
        // Proposals are the owner's and admins' business; members only ever see sent rounds.
        proposedRound: manager && proposed ? { number: proposed.number, kind: proposed.kind, createdAt: toIso(proposed.created_at) ?? proposed.created_at } : null,
        pendingAsks,
        faces,
      };
    })
  );

  surveys_list.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));

  return c.json({ surveys: surveys_list });
});

// ── DELETE /api/my/surveys/:id ── Soft-delete a survey (sets status to 'deleted')
surveys.delete("/api/my/surveys/:id", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const surveyId = c.req.param("id");
  const db = c.env.DB;

  // Only the owner can delete a parlo
  const survey = await db
    .prepare("SELECT id FROM surveys WHERE id = ? AND creator_id = ?")
    .bind(surveyId, userId)
    .first<{ id: string }>();

  if (!survey) return c.json({ error: "Survey not found" }, 404);

  await db
    .prepare("UPDATE surveys SET status = 'deleted' WHERE id = ?")
    .bind(surveyId)
    .run();

  return c.json({ ok: true });
});

export default surveys;

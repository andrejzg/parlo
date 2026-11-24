import { Hono } from "hono";
import { asPublishConsent, type Env, type Survey, type SurveyQuestion, type StartResponseResponse, type SubmitResponseRequest, type GroupVisibility } from "../types";
import { generateId, generateCode } from "../services/codes";
import { extractCode } from "../services/slug";
import { generatePresignedUploadUrl, generateUploadToken } from "../services/r2";
import { checkRateLimit } from "../services/ratelimit";
import { trackServerEvent } from "../services/analytics";
import { transcribeResponseAnswers } from "../services/transcription";
import { getMemberByToken, updateUserNames, upsertUserByPhone } from "../services/groups";
import { submitResponse } from "../services/responses";
import { PhoneProofError, resolveVerifiedPhone } from "../services/phoneProof";
import type { AuthVariables } from "../middleware/auth";
import { latestSentRound, pendingAsksFor } from "../services/rounds";
import { notifyManagers } from "../services/notify";
import { judgeAnswers, MAX_PROBES, probeKey, probeShownKey, probesAsked, probesShown, wordCount, writeProbe } from "../services/answerJudge";
import { transcribeAudio } from "../services/ai";

const responses = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

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

  // Identity, in order of trust: the caller's API key (a device that passed
  // OTP before), a phone proof from this session's OTP, then the member token
  // the session was started with (the service falls back to it). A bare phone
  // in the body proves nothing and is ignored.
  let userId: string | null = c.get("userId") ?? null;
  if (!userId && (body.idToken || body.proof)) {
    try {
      const verified = await resolveVerifiedPhone(c.env, body);
      const user = await upsertUserByPhone(db, verified.phone, { firstName: body.firstName ?? null, lastName: body.lastName ?? null });
      userId = user.id;
    } catch (err) {
      if (err instanceof PhoneProofError) return c.json({ error: err.message, code: err.code }, err.status);
      throw err;
    }
  } else if (userId) {
    await updateUserNames(db, userId, body.firstName ?? null, body.lastName ?? null);
  }

  const result = await submitResponse(
    c.env,
    c.executionCtx,
    responseId,
    {
      userId,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      publishConsent: asPublishConsent(body.publishConsent),
      testimonialAck: Array.isArray(body.testimonialAck) ? body.testimonialAck.filter((id): id is string => typeof id === "string") : [],
    },
    "web"
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ success: true, id: responseId, memberToken: result.memberToken, visibility: result.visibility });
});

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

// ── POST /api/responses/:id/probe ── Did that answer the question? If not, one follow-up
//
// Called by the participant page right after a voice answer is recorded, on a
// study. Multipart: `audio` (the take, or just the newest clip after a
// follow-up), `questionId`, and `transcriptSoFar` (what earlier clips of the
// same answer said). Whisper, then the answer judge; when the answer falls
// short and the agent has follow-ups left, it writes one. After MAX_PROBES it
// lets go. Nothing here decides pay: the verdict that counts is taken from the
// stored transcript when the response is submitted (services/answerJudge.ts).
const MAX_PROBE_BYTES = 12 * 1024 * 1024;

responses.post("/api/responses/:id/probe", async (c) => {
  const responseId = c.req.param("id");
  const db = c.env.DB;
  const none = { verdict: null, transcript: "", probe: null, letGo: false };
  const response = await db
    .prepare(
      `SELECT r.id, r.status, r.survey_id, s.kind, s.sponsor_name FROM responses r JOIN surveys s ON s.id = r.survey_id WHERE r.id = ?`
    )
    .bind(responseId)
    .first<{ id: string; status: string; survey_id: string; kind: string | null; sponsor_name: string | null }>();
  if (!response) return c.json({ error: "Response not found" }, 404);
  if (response.status !== "in_progress") return c.json({ error: "Response already submitted" }, 400);
  // Probing is a study's instrument; a group parlo takes the answer as it comes.
  if (response.kind !== "study" && !response.sponsor_name) return c.json(none);
  if (!(await checkRateLimit(c.env.KV, "probe", responseId, 40))) return c.json(none);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("audio") as unknown;
  const questionId = String(form?.get("questionId") ?? "");
  const soFar = String(form?.get("transcriptSoFar") ?? "").slice(0, 8000);
  if (!file || typeof file !== "object" || !("arrayBuffer" in file) || !questionId) return c.json({ error: "audio and questionId are required" }, 400);
  const question = await db
    .prepare("SELECT q.id, q.text, q.question_type, r.purpose FROM survey_questions q LEFT JOIN rounds r ON r.id = q.round_id WHERE q.id = ? AND q.survey_id = ?")
    .bind(questionId, response.survey_id)
    .first<{ id: string; text: string; question_type: string; purpose: string | null }>();
  if (!question) return c.json({ error: "That question is not in this parlo" }, 404);
  // A testimonial is a line the person chose to give; it is not interrogated.
  if (question.question_type !== "voice" || question.purpose === "testimonial") return c.json(none);

  const buf = await (file as Blob).arrayBuffer();
  if (buf.byteLength === 0) return c.json(none);
  if (buf.byteLength > MAX_PROBE_BYTES) return c.json({ error: "Audio too large" }, 413);

  let heard = "";
  try {
    heard = ((await transcribeAudio(c.env.AI, buf, `probe-${responseId}`)) ?? "").trim();
  } catch (err) {
    console.error("[probe] transcription failed", err);
    return c.json(none);
  }
  const transcript = [soFar.trim(), heard].filter(Boolean).join(" ").trim();
  // `written`: every follow-up made for this answer. `asked`: the ones the
  // participant saw (the page says so, POST …/probe/shown). The limit counts
  // what was seen; a follow-up that came back too late to show does not use
  // one up. Writing stops regardless once four have been made.
  const [written, asked] = await Promise.all([probesAsked(c.env.KV, responseId, question.id), probesShown(c.env.KV, responseId, question.id)]);

  const [judged] = wordCount(transcript) === 0 ? [{ verdict: "unanswered" as const, score: 0 }] : await judgeAnswers(c.env, [{ question: question.text, transcript }], "probe-judge");
  if (!judged) return c.json({ ...none, transcript });
  if (judged.verdict === "answered") {
    if (asked.length > 0) trackServerEvent(responseId, "probe_answered", { surveyId: response.survey_id, questionId: question.id, probes: asked.length });
    return c.json({ verdict: judged.verdict, transcript, probe: null, letGo: false });
  }
  if (asked.length >= MAX_PROBES) {
    trackServerEvent(responseId, "probe_let_go", { surveyId: response.survey_id, questionId: question.id, verdict: judged.verdict });
    return c.json({ verdict: judged.verdict, transcript, probe: null, letGo: true });
  }
  // "Partly" is worth one follow-up, not two: the second is kept for an answer that is still missing.
  if (judged.verdict === "partial" && asked.length >= 1) return c.json({ verdict: judged.verdict, transcript, probe: null, letGo: true });
  if (written.length >= MAX_PROBES + 2) return c.json({ verdict: judged.verdict, transcript, probe: null, letGo: true });

  const probe = await writeProbe(c.env, { question: question.text, transcript, earlier: written });
  if (!probe) return c.json({ verdict: judged.verdict, transcript, probe: null, letGo: false });
  await c.env.KV.put(probeKey(responseId, question.id), JSON.stringify([...written, probe]), { expirationTtl: 2 * 24 * 3600 });
  trackServerEvent(responseId, "probe_asked", { surveyId: response.survey_id, questionId: question.id, n: asked.length + 1, verdict: judged.verdict });
  return c.json({ verdict: judged.verdict, transcript, probe: { text: probe }, letGo: false, remaining: MAX_PROBES - asked.length - 1 });
});

// ── POST /api/responses/:id/probe/shown ── The participant saw this follow-up
//
// Body `{questionId, text}`. Only a follow-up this server wrote for that
// answer can be marked, so the list kept with the answer is the agent's own
// words and nothing a client made up.
responses.post("/api/responses/:id/probe/shown", async (c) => {
  const responseId = c.req.param("id");
  const body = await c.req.json<{ questionId?: unknown; text?: unknown }>().catch(() => ({} as { questionId?: unknown; text?: unknown }));
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!questionId || !text) return c.json({ error: "questionId and text are required" }, 400);
  const response = await c.env.DB.prepare("SELECT status FROM responses WHERE id = ?").bind(responseId).first<{ status: string }>();
  if (!response) return c.json({ error: "Response not found" }, 404);
  if (response.status !== "in_progress") return c.json({ ok: true });
  const [written, shown] = await Promise.all([probesAsked(c.env.KV, responseId, questionId), probesShown(c.env.KV, responseId, questionId)]);
  if (!written.includes(text)) return c.json({ error: "That follow-up was not asked here" }, 404);
  if (!shown.includes(text)) {
    await c.env.KV.put(probeShownKey(responseId, questionId), JSON.stringify([...shown, text]), { expirationTtl: 2 * 24 * 3600 });
  }
  return c.json({ ok: true });
});

// ── POST /api/s/:code/asks/:questionId/decline ── "I'd rather not" to a testimonial ask
//
// Only a testimonial ask can be declined: it stops being pending for that
// person and they are not asked it again. Personal link only.
responses.post("/api/s/:code/asks/:questionId/decline", async (c) => {
  const code = extractCode(c.req.param("code"));
  const db = c.env.DB;
  const survey = await db.prepare("SELECT id FROM surveys WHERE code = ? AND status = 'active'").bind(code).first<{ id: string }>();
  if (!survey) return c.json({ error: "Parlo not found" }, 404);
  const member = await getMemberByToken(db, survey.id, c.req.query("t"));
  if (!member) return c.json({ error: "This link isn't valid for this parlo" }, 403);
  const question = await db
    .prepare(
      `SELECT q.id, q.target_user_id, r.purpose, r.id AS round_id FROM survey_questions q JOIN rounds r ON r.id = q.round_id
       WHERE q.id = ? AND q.survey_id = ? AND r.status = 'sent'`
    )
    .bind(c.req.param("questionId"), survey.id)
    .first<{ id: string; target_user_id: string | null; purpose: string | null; round_id: string }>();
  if (!question || (question.target_user_id && question.target_user_id !== member.user_id)) return c.json({ error: "That ask isn't waiting for you" }, 404);
  if (question.purpose !== "testimonial") return c.json({ error: "Only a testimonial ask can be declined" }, 400);
  await db.prepare("INSERT OR IGNORE INTO ask_declines (question_id, user_id) VALUES (?, ?)").bind(question.id, member.user_id).run();
  trackServerEvent(member.user_id, "testimonial_declined", { surveyId: survey.id, roundId: question.round_id });
  return c.json({ ok: true });
});

export default responses;

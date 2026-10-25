import { Hono } from "hono";
import type { Env, Survey, SurveyQuestion, StartResponseResponse, SubmitResponseRequest, GroupVisibility } from "../types";
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

  const result = await submitResponse(c.env, c.executionCtx, responseId, { userId, firstName: body.firstName ?? null, lastName: body.lastName ?? null }, "web");
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

export default responses;

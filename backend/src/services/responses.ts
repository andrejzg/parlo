import { asPublishConsent, type Env, type Survey, type SurveyQuestion, type GroupVisibility, type PublishConsent } from "../types";
import { generateId } from "./codes";
import { ensureMember, getMembership } from "./groups";
import { createRewardsForResponse, settleRewardsForResponse, type SettledReward } from "./rewards";
import { notifyManagers } from "./notify";
import { trackServerEvent } from "./analytics";
import { ingestIntoAgent, transcribeResponseAnswers } from "./transcription";

export type SubmitOutcome =
  | {
      ok: true;
      responseId: string;
      surveyId: string;
      memberToken: string | null;
      visibility: GroupVisibility;
      answers: number;
      /** Rewards settled inside this call (only when every transcript already existed: the WhatsApp bot). */
      rewards: SettledReward[];
    }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Turn an in-progress response into a submitted one: stamp identity and
 * visibility, create `response_answers` rows for whatever landed in R2,
 * tell the managers, transcribe in the background. Shared by
 * `POST /api/responses/:id/submit` (web) and the WhatsApp bot. `who.userId`
 * is the caller's already-proven identity, or null to keep what the session
 * started with (anonymous when there was no member token).
 */
export async function submitResponse(
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  responseId: string,
  who: { userId: string | null; firstName?: string | null; lastName?: string | null; publishConsent?: PublishConsent },
  source: "web" | "whatsapp",
  /** Transcripts already made (the WhatsApp bot transcribes each voice note on receipt), by question id. */
  pretranscribed: Record<string, string> = {}
): Promise<SubmitOutcome> {
  const db = env.DB;
  const existing = await db
    .prepare("SELECT id, survey_id, status, user_id FROM responses WHERE id = ?")
    .bind(responseId)
    .first<{ id: string; survey_id: string; status: string; user_id: string | null }>();
  if (!existing) return { ok: false, status: 404, error: "Response not found" };
  if (existing.status !== "in_progress") return { ok: false, status: 400, error: "Response already submitted" };

  const survey = await db.prepare("SELECT * FROM surveys WHERE id = ?").bind(existing.survey_id).first<Survey>();
  if (!survey) return { ok: false, status: 404, error: "Survey not found" };
  const visibility: GroupVisibility = survey.visibility === "open" ? "open" : "private";

  const userId = who.userId ?? existing.user_id;
  const identity = userId
    ? await db.prepare("SELECT phone FROM users WHERE id = ?").bind(userId).first<{ phone: string | null }>()
    : null;
  const phone = identity?.phone ?? null;
  let memberToken: string | null = null;
  // Paid only if they were a participant of this study before this answer:
  // someone who came by a personal link, not by the open one (services/rewards.ts).
  const before = userId ? await getMembership(db, existing.survey_id, userId) : null;
  const wasParticipant = before?.role === "member";
  if (userId) {
    const membership = await ensureMember(db, existing.survey_id, userId, "member");
    memberToken = membership.removed_at ? null : membership.access_token;
  }

  await db
    .prepare(
      `UPDATE responses
       SET phone = ?, first_name = ?, last_name = ?, user_id = ?, visibility_at_submit = ?, sponsor_consent = ?, publish_consent = ?,
           status = 'submitted', submitted_at = datetime('now')
       WHERE id = ?`
    )
    // The consent screen named the sponsor if the study had one when this was submitted.
    // Publication consent is only ever what the participant chose on that screen; the bot never asks, so it is none there.
    .bind(phone, who.firstName ?? null, who.lastName ?? null, userId, visibility, survey.sponsor_name ? 1 : 0, asPublishConsent(who.publishConsent), responseId)
    .run();

  // One response_answers row per file that landed in R2 (voice .webm/.wav,
  // photo .jpg, video .mp4). Probes aimed at someone else are skipped.
  const questions = await db
    .prepare("SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order")
    .bind(existing.survey_id)
    .all<SurveyQuestion>();
  const inserts: D1PreparedStatement[] = [];
  let pendingCount = 0;
  for (const q of questions.results) {
    if (q.target_user_id && q.target_user_id !== userId) continue;
    if (q.question_type === "photo") {
      const key = `responses/${responseId}/${q.id}.jpg`;
      if (await env.AUDIO_BUCKET.head(key)) {
        inserts.push(
          db
            .prepare("INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, image_r2_key, duration_ms, transcription_status) VALUES (?, ?, ?, '', ?, 0, 'completed')")
            .bind(generateId(), responseId, q.id, key)
        );
      }
      continue;
    }
    if (q.question_type === "video") {
      const key = `responses/${responseId}/${q.id}.mp4`;
      if (await env.AUDIO_BUCKET.head(key)) {
        pendingCount += 1;
        inserts.push(
          db
            .prepare("INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, video_r2_key, duration_ms, transcription_status) VALUES (?, ?, ?, '', ?, 0, 'pending')")
            .bind(generateId(), responseId, q.id, key)
        );
      }
      continue;
    }
    const webmKey = `responses/${responseId}/${q.id}.webm`;
    const wavKey = `responses/${responseId}/${q.id}.wav`;
    const audioKey = (await env.AUDIO_BUCKET.head(webmKey)) ? webmKey : (await env.AUDIO_BUCKET.head(wavKey)) ? wavKey : null;
    if (audioKey) {
      const text = pretranscribed[q.id];
      if (typeof text === "string") {
        inserts.push(
          db
            .prepare("INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, duration_ms, transcription, transcription_status) VALUES (?, ?, ?, ?, 0, ?, 'completed')")
            .bind(generateId(), responseId, q.id, audioKey, text)
        );
      } else {
        pendingCount += 1;
        inserts.push(
          db
            .prepare("INSERT INTO response_answers (id, response_id, question_id, audio_r2_key, duration_ms, transcription_status) VALUES (?, ?, ?, ?, 0, 'pending')")
            .bind(generateId(), responseId, q.id, audioKey)
        );
      }
    }
  }
  if (inserts.length > 0) await db.batch(inserts);
  await createRewardsForResponse(env, { id: responseId, survey_id: existing.survey_id }, userId, wasParticipant).catch((err) =>
    console.error(`[submit] reward rows failed for ${responseId}:`, err)
  );

  trackServerEvent(phone ?? responseId, "response_submitted", {
    responseId,
    surveyId: existing.survey_id,
    hasPhone: !!phone,
    joined: !!memberToken,
    visibility,
    source,
    answers: inserts.length,
  });
  if (phone) {
    trackServerEvent(phone, "$identify", {
      $set: { phone, first_name: who.firstName, last_name: who.lastName, role: "participant" },
    });
  }

  const firstName = who.firstName ?? "Someone";
  const surveyTitle = survey.title ?? "Untitled";
  await notifyManagers(env, existing.survey_id, {
    type: "new_response",
    title: `${firstName} responded to ${surveyTitle}`,
    surveyId: existing.survey_id,
    surveyTitle,
  });

  let rewards: SettledReward[] = [];
  if (pendingCount > 0) {
    // Web uploads: Whisper in the background, then the agent ingests and the rewards settle.
    ctx.waitUntil(transcribeResponseAnswers(env, responseId));
  } else if (inserts.length > 0) {
    // Everything already transcribed (the bot): hand it to the agent now, in the request.
    await ingestIntoAgent(env, responseId).catch((err) => console.error(`[submit] agent ingest failed for ${responseId}:`, err));
    rewards = await settleRewardsForResponse(env, responseId).catch((err) => {
      console.error(`[submit] reward settle failed for ${responseId}:`, err);
      return [];
    });
  }
  return { ok: true, responseId, surveyId: existing.survey_id, memberToken, visibility, answers: inserts.length, rewards };
}

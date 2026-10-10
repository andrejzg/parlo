/**
 * Background transcription service: fetches audio from R2 and runs Whisper STT.
 * Processes sequentially to avoid Workers AI rate limits. When a response
 * has finished transcribing, the group's agent ingests its transcripts.
 */

import { getAgentByName } from "agents";
import type { Env, ResponseAnswer } from "../types";
import { transcribeAudio } from "./ai";
import { displayNameFor } from "./groups";

export async function transcribeResponseAnswers(
  env: Env,
  responseId: string
): Promise<void> {
  const db = env.DB;

  const pending = await db
    .prepare(
      "SELECT * FROM response_answers WHERE response_id = ? AND transcription_status = 'pending'"
    )
    .bind(responseId)
    .all<ResponseAnswer>();

  for (const answer of pending.results) {
    try {
      // Voice answers store the file in audio_r2_key. Video answers store
      // in video_r2_key with audio_r2_key = "". Whisper accepts the raw
      // video file bytes and just reads the audio track, so we can pass
      // either through the same call.
      const r2Key = answer.audio_r2_key || answer.video_r2_key;
      if (!r2Key) {
        console.error(
          `[transcription] No R2 key for answer ${answer.id}`
        );
        await db
          .prepare(
            "UPDATE response_answers SET transcription_status = 'failed' WHERE id = ?"
          )
          .bind(answer.id)
          .run();
        continue;
      }

      const obj = await env.AUDIO_BUCKET.get(r2Key);
      if (!obj) {
        console.error(
          `[transcription] R2 object not found: ${r2Key}`
        );
        await db
          .prepare(
            "UPDATE response_answers SET transcription_status = 'failed' WHERE id = ?"
          )
          .bind(answer.id)
          .run();
        continue;
      }

      const audioBuffer = await obj.arrayBuffer();
      const text = await transcribeAudio(env.AI, audioBuffer, responseId);

      await db
        .prepare(
          "UPDATE response_answers SET transcription = ?, transcription_status = 'completed' WHERE id = ?"
        )
        .bind(text, answer.id)
        .run();

      console.log(
        `[transcription] Completed for answer ${answer.id}: ${text.length} chars`
      );
    } catch (err) {
      console.error(
        `[transcription] Failed for answer ${answer.id}:`,
        err
      );
      await db
        .prepare(
          "UPDATE response_answers SET transcription_status = 'failed' WHERE id = ?"
        )
        .bind(answer.id)
        .run();
    }
  }

  await ingestIntoAgent(env, responseId).catch((err) => {
    console.error(`[transcription] Agent ingest failed for ${responseId}:`, err);
  });
}

/** Hand every completed answer of a response to the parlo's agent. */
export async function ingestIntoAgent(env: Env, responseId: string): Promise<void> {
  const db = env.DB;
  const response = await db
    .prepare(
      `SELECT r.id, r.survey_id, r.user_id, r.first_name, r.last_name, r.submitted_at,
              u.first_name AS u_first, u.last_name AS u_last, u.wa_name, u.linkedin_name, u.phone
       FROM responses r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?`
    )
    .bind(responseId)
    .first<{
      id: string;
      survey_id: string;
      user_id: string | null;
      first_name: string | null;
      last_name: string | null;
      submitted_at: string | null;
      u_first: string | null;
      u_last: string | null;
      wa_name: string | null;
      linkedin_name: string | null;
      phone: string | null;
    }>();
  if (!response) return;

  const answers = await db
    .prepare(
      `SELECT ra.question_id, ra.transcription, q.text AS question_text, q.question_type, rd.number AS round_number
       FROM response_answers ra
       JOIN survey_questions q ON q.id = ra.question_id
       LEFT JOIN rounds rd ON rd.id = q.round_id
       WHERE ra.response_id = ? AND ra.transcription_status = 'completed'
       ORDER BY q.sort_order ASC`
    )
    .bind(responseId)
    .all<{ question_id: string; transcription: string | null; question_text: string; question_type: "voice" | "photo" | "video"; round_number: number | null }>();
  if (answers.results.length === 0) return;

  const displayName =
    displayNameFor({ first_name: response.u_first, last_name: response.u_last, wa_name: response.wa_name, linkedin_name: response.linkedin_name, phone: response.phone }) ??
    [response.first_name, response.last_name].filter(Boolean).join(" ") ??
    null;

  const agent = await getAgentByName(env.GROUP_AGENT, response.survey_id);
  await agent.ingestResponse({
    surveyId: response.survey_id,
    responseId: response.id,
    userId: response.user_id,
    displayName: displayName || null,
    submittedAt: response.submitted_at,
    answers: answers.results.map((a) => ({
      questionId: a.question_id,
      questionText: a.question_text,
      roundNumber: a.round_number ?? 1,
      kind: a.question_type,
      transcript: a.transcription,
    })),
  });
}

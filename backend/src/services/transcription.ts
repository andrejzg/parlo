/**
 * Background transcription service: fetches audio from R2 and runs Whisper STT.
 * Processes sequentially to avoid Workers AI rate limits.
 */

import type { Env, ResponseAnswer } from "../types";
import { transcribeAudio } from "./ai";

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
}

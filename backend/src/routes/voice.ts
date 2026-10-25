import { Hono } from "hono";
import type { Env } from "../types";
import type { AuthVariables } from "../middleware/auth";
import { checkRateLimit } from "../services/ratelimit";
import { generatePresignedReadUrl, generateReadToken, uploadToR2 } from "../services/r2";
import { trackServerEvent } from "../services/analytics";
import {
  cloneVoice,
  deleteVoice,
  InworldError,
  synthesize,
  SYNTHESIS_MAX_CHARS,
  VOICE_SAMPLE_MAX_BYTES,
} from "../services/inworld";
import { VOICE_PASSAGE, VOICE_PREVIEW_LINE } from "../services/voicePassage";

/**
 * The creator's cloned voice and the typed opener.
 *
 * The flow opens with the creator reading `VOICE_PASSAGE` out loud. The phone
 * sends the take here as WAV; Inworld clones it in a few seconds and the
 * voice id lands on the creator's `users` row, so every parlo they make can
 * speak as them. The typed opener is synthesised in that voice and stored
 * where a recorded intro would be (`surveys.intro_*`), so participants and
 * the agent see no difference.
 */
const voice = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

type CreatorRow = { creator_id: string; voice_id: string | null };

async function creatorOf(db: D1Database, surveyId: string): Promise<CreatorRow | null> {
  return db
    .prepare("SELECT s.creator_id, u.voice_id FROM surveys s JOIN users u ON u.id = s.creator_id WHERE s.id = ?")
    .bind(surveyId)
    .first<CreatorRow>();
}

function inworldFailure(c: { json: (b: unknown, s: 502 | 503) => Response }, err: unknown, surveyId: string, where: string) {
  console.error(`Inworld ${where} failed`, { surveyId, err });
  if (err instanceof InworldError) {
    const status = err.status === 503 ? 503 : 502;
    return c.json({ error: status === 503 ? "Voice cloning is not configured" : `Voice service failed (${where})` }, status);
  }
  return c.json({ error: `Voice service failed (${where})` }, 502);
}

// ── GET /api/surveys/:id/voice ── Has this parlo's creator cloned their voice?
voice.get("/api/surveys/:id/voice", async (c) => {
  const surveyId = c.req.param("id");
  const row = await creatorOf(c.env.DB, surveyId);
  if (!row) return c.json({ error: "Survey not found" }, 404);
  return c.json({ cloned: !!row.voice_id, passage: VOICE_PASSAGE });
});

// ── POST /api/surveys/:id/voice/clone ── Clone the creator's voice from the read-out
//
// Body: raw audio bytes (`audio/wav` or `audio/mpeg`; Inworld takes nothing
// else) or multipart with an `audio` field. Max 12 MB. Stores the sample in
// R2, clones it, writes `users.voice_id`, and synthesises a short preview so
// the creator hears their clone straight away.
// Returns `{voiceId, preview: {audioUrl, durationMs}}`.
voice.post("/api/surveys/:id/voice/clone", async (c) => {
  const surveyId = c.req.param("id");
  const db = c.env.DB;

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (!(await checkRateLimit(c.env.KV, "voice-clone", ip, 30))) {
    return c.json({ error: "Too many voice clones. Try again later." }, 429);
  }

  const row = await creatorOf(db, surveyId);
  if (!row) return c.json({ error: "Survey not found" }, 404);

  const contentType = c.req.header("content-type") ?? "";
  let buf: ArrayBuffer;
  let mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime.startsWith("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("audio");
    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      return c.json({ error: "Missing audio field" }, 400);
    }
    buf = await (file as Blob).arrayBuffer();
    mime = ((file as Blob).type || "audio/wav").toLowerCase();
  } else {
    buf = await c.req.arrayBuffer();
  }
  if (buf.byteLength === 0) return c.json({ error: "Empty recording" }, 400);
  if (buf.byteLength > VOICE_SAMPLE_MAX_BYTES) return c.json({ error: "Recording too large (max 12 MB)" }, 413);

  const isWav = mime === "audio/wav" || mime === "audio/x-wav" || mime === "audio/wave";
  const isMp3 = mime === "audio/mpeg" || mime === "audio/mp3";
  if (!isWav && !isMp3) {
    return c.json({ error: "Send the sample as WAV or MP3" }, 415);
  }

  const sampleKey = `surveys/${surveyId}/voice-sample.${isWav ? "wav" : "mp3"}`;
  await uploadToR2(c.env.AUDIO_BUCKET, sampleKey, buf, isWav ? "audio/wav" : "audio/mpeg");

  let voiceId: string;
  try {
    voiceId = await cloneVoice(c.env, {
      audio: buf,
      displayName: `parlo-${row.creator_id.slice(0, 8)}`,
      transcription: VOICE_PASSAGE,
    });
  } catch (err) {
    return inworldFailure(c, err, surveyId, "clone");
  }

  // Replacing an earlier clone: drop the old voice from the workspace quietly.
  if (row.voice_id && row.voice_id !== voiceId) {
    c.executionCtx.waitUntil(deleteVoice(c.env, row.voice_id));
  }

  await db
    .prepare("UPDATE users SET voice_id = ?, voice_sample_r2_key = ?, voice_cloned_at = ? WHERE id = ?")
    .bind(voiceId, sampleKey, new Date().toISOString(), row.creator_id)
    .run();
  trackServerEvent(row.creator_id, "voice_cloned", { surveyId, bytes: buf.byteLength, mime });

  // The magic moment: hear yourself say something you never said.
  let preview: { audioUrl: string; durationMs: number } | null = null;
  try {
    const synth = await synthesize(c.env, VOICE_PREVIEW_LINE, voiceId);
    const previewKey = `surveys/${surveyId}/voice-preview.mp3`;
    await uploadToR2(c.env.AUDIO_BUCKET, previewKey, synth.audio, synth.contentType);
    const token = await generateReadToken(c.env.KV, previewKey);
    preview = {
      audioUrl: generatePresignedReadUrl(new URL(c.req.url).origin, previewKey, token),
      durationMs: synth.durationMs,
    };
  } catch (err) {
    // The clone exists; the preview is a nicety.
    console.error("Voice preview synthesis failed", { surveyId, err });
  }

  return c.json({ voiceId, preview });
});

// ── POST /api/surveys/:id/intro/synthesize ── A typed opener, said in the creator's voice
//
// Body `{text}` (≤600 chars). 409 until the creator has cloned their voice.
// Writes the MP3 to `surveys/{id}/intro.mp3` and the intro columns
// (`intro_kind = 'text'`, transcript = the text), replacing any earlier opener.
// Returns `{audioUrl, durationMs}` so the creator can hear it before moving on.
voice.post("/api/surveys/:id/intro/synthesize", async (c) => {
  const surveyId = c.req.param("id");
  const db = c.env.DB;

  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  if (!(await checkRateLimit(c.env.KV, "voice-synth", ip, 120))) {
    return c.json({ error: "Too many requests. Try again later." }, 429);
  }

  const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "Nothing to say" }, 400);
  if (text.length > SYNTHESIS_MAX_CHARS) return c.json({ error: `Keep it under ${SYNTHESIS_MAX_CHARS} characters` }, 400);

  const row = await creatorOf(db, surveyId);
  if (!row) return c.json({ error: "Survey not found" }, 404);
  if (!row.voice_id) return c.json({ error: "Clone your voice first", code: "no_voice" }, 409);

  let synth;
  try {
    synth = await synthesize(c.env, text, row.voice_id);
  } catch (err) {
    return inworldFailure(c, err, surveyId, "synthesize");
  }

  const key = `surveys/${surveyId}/intro.mp3`;
  await uploadToR2(c.env.AUDIO_BUCKET, key, synth.audio, synth.contentType);
  await db
    .prepare("UPDATE surveys SET intro_r2_key = ?, intro_duration_ms = ?, intro_transcript = ?, intro_kind = 'text' WHERE id = ?")
    .bind(key, synth.durationMs, text, surveyId)
    .run();
  trackServerEvent(surveyId, "survey_intro_saved", { surveyId, kind: "text", durationMs: synth.durationMs, chars: synth.charactersProcessed });

  const token = await generateReadToken(c.env.KV, key);
  return c.json({
    audioUrl: generatePresignedReadUrl(new URL(c.req.url).origin, key, token),
    durationMs: synth.durationMs,
  });
});

export default voice;

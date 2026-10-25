import type { Env } from "../types";
import { transcribeAudioDetailed } from "./ai";
import { trackServerEvent } from "./analytics";

/** Longest opener we will take from a URL or a voice note (≈10 min of Opus). */
export const MAX_INTRO_BYTES = 12 * 1024 * 1024;
const INTRO_FETCH_TIMEOUT_MS = 20_000;

export function introKey(surveyId: string) {
  return `surveys/${surveyId}/intro.webm`;
}

export interface StoredIntro {
  durationMs: number;
  transcript: string;
  bytes: number;
  contentType: string;
}

/**
 * Store opener bytes under the intro key, transcribe them now (the caller
 * usually wants the words), and write the three intro columns.
 */
export async function storeIntroBytes(env: Env, surveyId: string, buf: ArrayBuffer, contentType: string, source: string): Promise<StoredIntro> {
  const key = introKey(surveyId);
  await env.AUDIO_BUCKET.put(key, buf, { httpMetadata: { contentType: contentType || "audio/ogg" } });

  let transcript = "";
  let durationMs = 0;
  try {
    const detailed = await transcribeAudioDetailed(env.AI, buf, `survey-${surveyId}`);
    transcript = detailed.text.trim();
    durationMs = detailed.durationMs ?? 0;
  } catch (err) {
    console.error("[intro] transcription failed", { surveyId, source, err });
  }

  await env.DB
    .prepare("UPDATE surveys SET intro_r2_key = ?, intro_duration_ms = ?, intro_transcript = ? WHERE id = ?")
    .bind(key, durationMs, transcript || null, surveyId)
    .run();

  trackServerEvent(surveyId, "survey_intro_saved", { surveyId, durationMs, source, bytes: buf.byteLength, contentType });
  return { durationMs, transcript, bytes: buf.byteLength, contentType };
}

export type IntroFromUrlOutcome =
  | { ok: true; saved: StoredIntro }
  | { ok: false; status: 400 | 413 | 415 | 502; error: string };

/** WhatsApp voice notes are audio/ogg; phones send m4a/mp4; some hosts say octet-stream. */
function isIntroContentType(ct: string): boolean {
  if (!ct) return true;
  return ct.startsWith("audio/") || ct.startsWith("video/") || ct === "application/octet-stream" || ct === "application/ogg";
}

/**
 * Fetch a creator's voice note from a URL into the opener slot. Shared by
 * `POST /intro/from-url` and `POST /api/agent/parlos`.
 */
export async function saveIntroFromUrl(env: Env, surveyId: string, rawUrl: unknown): Promise<IntroFromUrlOutcome> {
  let source: URL;
  try {
    source = new URL(typeof rawUrl === "string" ? rawUrl : "");
  } catch {
    return { ok: false, status: 400, error: "url must be an absolute https URL" };
  }
  if (source.protocol !== "https:") return { ok: false, status: 400, error: "url must use https" };

  let upstream: Response;
  try {
    upstream = await fetch(source.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(INTRO_FETCH_TIMEOUT_MS),
      headers: { Accept: "audio/*, video/*;q=0.9, */*;q=0.5", "User-Agent": "Parlo/1.0 (+https://parlo.me)" },
    });
  } catch (err) {
    console.error("[intro/from-url] fetch failed", { surveyId, err });
    return { ok: false, status: 502, error: "Could not fetch the audio URL" };
  }
  if (!upstream.ok) return { ok: false, status: 502, error: `Audio URL answered ${upstream.status}` };

  const declared = Number(upstream.headers.get("content-length") ?? "0");
  if (declared > MAX_INTRO_BYTES) return { ok: false, status: 413, error: "Audio too large" };
  const contentType = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!isIntroContentType(contentType)) {
    return { ok: false, status: 415, error: `Not an audio file (content-type ${contentType || "unknown"})` };
  }

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength === 0) return { ok: false, status: 400, error: "Empty audio" };
  if (buf.byteLength > MAX_INTRO_BYTES) return { ok: false, status: 413, error: "Audio too large" };

  const saved = await storeIntroBytes(env, surveyId, buf, contentType, "url");
  return { ok: true, saved };
}

/** KV key for the token in an `opener <code> <token>` WhatsApp deep link. */
export function openerTokenKey(token: string) {
  return `opener:${token}`;
}
export const OPENER_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

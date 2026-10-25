import type { Env } from "../types";

/**
 * Inworld TTS: instant voice cloning + synthesis in the cloned voice.
 *
 * Auth is `Authorization: Basic <INWORLD_API_KEY>` — the key from the Portal is
 * already the Base64 credential, so it is sent as is (never re-encoded).
 * Docs: https://docs.inworld.ai/tts/instant-voice-cloning,
 *       https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech
 */

const INWORLD_API = "https://api.inworld.ai";

/** Flagship model; the only one documented for both instant and professional clones. */
export const INWORLD_MODEL = "inworld-tts-2";

/** Inworld trims clone samples at 30 s; longer uploads are wasted bytes. */
export const VOICE_SAMPLE_MAX_BYTES = 12 * 1024 * 1024;

/** `POST /tts/v1/voice` takes 2,000 UTF-16 code units; an opener is well under that. */
export const SYNTHESIS_MAX_CHARS = 600;

/** MP3 bitrate we ask for; also what the duration estimate is based on. */
const MP3_BIT_RATE = 128_000;

export class InworldError extends Error {
  constructor(message: string, public status: number, public body?: string) {
    super(message);
  }
}

function requireKey(env: Env): string {
  if (!env.INWORLD_API_KEY) {
    throw new InworldError("INWORLD_API_KEY is not configured", 503);
  }
  return env.INWORLD_API_KEY;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function inworldFetch<T>(env: Env, path: string, body: unknown): Promise<T> {
  const key = requireKey(env);
  const res = await fetch(`${INWORLD_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new InworldError(`Inworld ${path} failed with ${res.status}`, res.status, text.slice(0, 500));
  }
  return (await res.json()) as T;
}

export interface CloneVoiceInput {
  /** WAV or MP3 bytes (Inworld's API takes those two; webm/Opus must be transcoded on the phone first). */
  audio: ArrayBuffer;
  /** Shown in the Inworld workspace; never user-facing. */
  displayName: string;
  /** What was said — the fixed passage, so Inworld needn't guess. */
  transcription?: string;
  /** BCP-47 like `en-US`; omitted = auto-detect. */
  languageCode?: string;
}

interface CloneVoiceResponse {
  voice?: { voiceId?: string; name?: string; source?: string };
  audioSamplesValidated?: { errors?: unknown[]; warnings?: unknown[] }[];
}

/** Instant voice clone. Returns the `voiceId` to pass to `synthesize()`. */
export async function cloneVoice(env: Env, input: CloneVoiceInput): Promise<string> {
  const data = await inworldFetch<CloneVoiceResponse>(env, "/voices/v1/voices:clone", {
    displayName: input.displayName,
    ...(input.languageCode ? { languageCode: input.languageCode } : {}),
    voiceSamples: [
      {
        audioData: toBase64(input.audio),
        ...(input.transcription ? { transcription: input.transcription } : {}),
      },
    ],
    description: "Parlo creator voice (instant clone from the read-out passage).",
    tags: ["parlo"],
    // The read-out happens on a phone, often somewhere noisy.
    audioProcessingConfig: { removeBackgroundNoise: true },
  });
  const voiceId = data.voice?.voiceId;
  if (!voiceId) {
    throw new InworldError("Inworld returned no voiceId", 502, JSON.stringify(data).slice(0, 500));
  }
  return voiceId;
}

export interface SynthesisResult {
  /** MP3 bytes at 128 kbps CBR. */
  audio: ArrayBuffer;
  contentType: "audio/mpeg";
  /** Estimated from the byte count and bitrate (CBR), within a frame or two. */
  durationMs: number;
  charactersProcessed: number;
}

interface SynthesizeResponse {
  audioContent?: string;
  usage?: { processedCharactersCount?: number; modelId?: string };
}

/** Say `text` in `voiceId`. MP3 so the participant player and R2 stay small. */
export async function synthesize(env: Env, text: string, voiceId: string): Promise<SynthesisResult> {
  const data = await inworldFetch<SynthesizeResponse>(env, "/tts/v1/voice", {
    text,
    voiceId,
    modelId: INWORLD_MODEL,
    audioConfig: { audioEncoding: "MP3", bitRate: MP3_BIT_RATE },
    deliveryMode: "BALANCED",
    applyTextNormalization: "ON",
  });
  if (!data.audioContent) {
    throw new InworldError("Inworld returned no audio", 502, JSON.stringify(data).slice(0, 500));
  }
  const audio = fromBase64(data.audioContent);
  return {
    audio,
    contentType: "audio/mpeg",
    durationMs: Math.round((audio.byteLength * 8 * 1000) / MP3_BIT_RATE),
    charactersProcessed: data.usage?.processedCharactersCount ?? text.length,
  };
}

/** Best-effort cleanup when a creator re-records (the voice is theirs to replace). */
export async function deleteVoice(env: Env, voiceId: string): Promise<void> {
  const key = requireKey(env);
  await fetch(`${INWORLD_API}/voices/v1/voices/${encodeURIComponent(voiceId)}`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${key}` },
  }).catch(() => {});
}

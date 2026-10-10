import { captureException, trackEvent } from "@/lib/posthog";

/**
 * Cheap silence trimming for voice recordings, done on the phone before the
 * blob is stored, played back or uploaded.
 *
 * - Leading and trailing silence is cut (a short pad is kept on each side so
 *   the first word isn't clipped and the last one has room to ring out).
 * - Pauses in the middle of 1 s or longer are shortened to a natural ~350 ms
 *   gap — the room tone on either side of the pause is what's kept, so there's
 *   no digital dead air.
 *
 * Decoding goes through an OfflineAudioContext, which also gives us a mono
 * 16 kHz mix for free. The result is 16-bit PCM WAV: the backend accepts WAV
 * bytes under the `.webm` upload key already (the multi-segment merge does
 * the same), Whisper is happiest at 16 kHz, and there is no cheap way to
 * re-encode Opus in a browser without shipping an encoder. If nothing worth
 * trimming is found, the original (compressed) blob is kept as-is.
 */

const FRAME_MS = 20;
const LEAD_PAD_MS = 120;
const TAIL_PAD_MS = 250;
/** Pauses at least this long are shortened… */
const LONG_SILENCE_MS = 1000;
/** …to this, split evenly before and after the cut. */
const KEEP_GAP_MS = 350;
/** Below this saving, keep the original blob (it's smaller than a WAV). */
const MIN_SAVING_MS = 200;
const MIN_INPUT_MS = 800;
const OUTPUT_RATE = 16000;
const FADE_MS = 5;
/** The gate never goes below this (near-digital silence)… */
const GATE_FLOOR_DB = -55;
/** …nor above this (quiet talkers in a noisy room). */
const GATE_CEIL_DB = -30;

export type TrimContext = "answer" | "intro" | "brief";

export interface TrimPlan {
  /** Sample ranges to keep, in order: [start, end). */
  keep: Array<[number, number]>;
  removedSamples: number;
}

export interface TrimResult {
  blob: Blob;
  durationMs: number;
  removedMs: number;
  changed: boolean;
}

interface Recording {
  blob: Blob;
  url?: string;
  durationMs: number;
}

function db(rms: number) {
  return 20 * Math.log10(rms + 1e-9);
}

function percentile(sorted: Float64Array, p: number) {
  if (sorted.length === 0) return -Infinity;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/**
 * Decide what to keep. Pure, so it's easy to test: frame the signal, gate
 * each frame against a level picked from the recording itself, then cut
 * the silent edges and shorten long silent runs.
 */
export function planTrim(pcm: Float32Array, sampleRate: number): TrimPlan {
  const n = pcm.length;
  const none: TrimPlan = { keep: [[0, n]], removedSamples: 0 };
  const frameLen = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const nFrames = Math.ceil(n / frameLen);
  if (n === 0 || nFrames < 3) return none;

  // Per-frame level in dBFS.
  const level = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const start = f * frameLen;
    const end = Math.min(n, start + frameLen);
    let sum = 0;
    for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
    level[f] = db(Math.sqrt(sum / Math.max(1, end - start)));
  }

  // Gate: well below the loud frames, a little above the quiet ones, clamped.
  const sorted = Float64Array.from(level).sort();
  const loud = percentile(sorted, 0.9);
  const floor = percentile(sorted, 0.1);
  if (loud - floor < 10) return none; // flat: all noise or all silence, nothing to find
  const gate = Math.min(GATE_CEIL_DB, Math.max(GATE_FLOOR_DB, Math.max(loud - 30, floor + 6)));

  // A frame counts as voice only with a voiced neighbour, so a 20 ms click
  // can't end the leading silence or split a long pause in two.
  const raw = new Uint8Array(nFrames);
  for (let f = 0; f < nFrames; f++) raw[f] = level[f] >= gate ? 1 : 0;
  const voiced = new Uint8Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    voiced[f] = raw[f] && ((f > 0 && raw[f - 1]) || (f + 1 < nFrames && raw[f + 1])) ? 1 : 0;
  }

  let first = -1;
  let last = -1;
  for (let f = 0; f < nFrames; f++) {
    if (voiced[f]) {
      if (first < 0) first = f;
      last = f;
    }
  }
  if (first < 0) return none;

  const ms = (x: number) => Math.round((sampleRate * x) / 1000);
  const removed: Array<[number, number]> = [];

  const leadEnd = Math.max(0, first * frameLen - ms(LEAD_PAD_MS));
  if (leadEnd > 0) removed.push([0, leadEnd]);

  const keepHalf = ms(KEEP_GAP_MS / 2);
  const longRun = Math.ceil(LONG_SILENCE_MS / FRAME_MS);
  let runStart = -1;
  for (let f = first; f <= last + 1; f++) {
    const silent = f <= last && !voiced[f];
    if (silent && runStart < 0) runStart = f;
    if (!silent && runStart >= 0) {
      if (f - runStart >= longRun) {
        const a = runStart * frameLen + keepHalf;
        const b = f * frameLen - keepHalf;
        if (b > a) removed.push([a, b]);
      }
      runStart = -1;
    }
  }

  const tailStart = Math.min(n, (last + 1) * frameLen + ms(TAIL_PAD_MS));
  if (tailStart < n) removed.push([tailStart, n]);

  const keep: Array<[number, number]> = [];
  let cursor = 0;
  let removedSamples = 0;
  for (const [a, b] of removed) {
    if (a > cursor) keep.push([cursor, a]);
    removedSamples += b - a;
    cursor = b;
  }
  if (cursor < n) keep.push([cursor, n]);
  return { keep, removedSamples };
}

function getOfflineCtor(): typeof OfflineAudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  return w.OfflineAudioContext || w.webkitOfflineAudioContext || null;
}

/** Decode any browser-recorded blob to mono PCM at OUTPUT_RATE. */
async function decodeMono(blob: Blob): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const Offline = getOfflineCtor();
  if (!Offline) throw new Error("OfflineAudioContext unavailable");
  const ab = await blob.arrayBuffer();
  const decoded = await new Offline(1, 1, OUTPUT_RATE).decodeAudioData(ab);
  let buf = decoded;
  if (decoded.sampleRate !== OUTPUT_RATE || decoded.numberOfChannels !== 1) {
    const ctx = new Offline(1, Math.max(1, Math.ceil(decoded.duration * OUTPUT_RATE)), OUTPUT_RATE);
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(ctx.destination);
    src.start(0);
    buf = await ctx.startRendering();
  }
  return { pcm: buf.getChannelData(0), sampleRate: buf.sampleRate };
}

/** Concatenate the kept ranges with short fades at every cut, as 16-bit mono WAV. */
export function encodeWav(pcm: Float32Array, sampleRate: number, keep: Array<[number, number]>): Blob {
  const total = keep.reduce((sum, [a, b]) => sum + (b - a), 0);
  const fade = Math.max(1, Math.round((sampleRate * FADE_MS) / 1000));
  const dataSize = total * 2;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const [a, b] of keep) {
    const len = b - a;
    for (let i = 0; i < len; i++) {
      let s = pcm[a + i];
      if (i < fade) s *= i / fade;
      if (len - 1 - i < fade) s *= (len - 1 - i) / fade;
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

/**
 * Trim a recording. Never throws on bad input — if the blob can't be decoded
 * (Playwright's fake recorder, an exotic codec) the caller gets it back as-is.
 */
export async function trimSilence(blob: Blob): Promise<TrimResult> {
  const { pcm, sampleRate } = await decodeMono(blob);
  const inputMs = (pcm.length / sampleRate) * 1000;
  const unchanged: TrimResult = { blob, durationMs: inputMs, removedMs: 0, changed: false };
  if (inputMs < MIN_INPUT_MS) return unchanged;

  const plan = planTrim(pcm, sampleRate);
  const removedMs = (plan.removedSamples / sampleRate) * 1000;
  if (removedMs < MIN_SAVING_MS) return unchanged;

  return {
    blob: encodeWav(pcm, sampleRate, plan.keep),
    durationMs: inputMs - removedMs,
    removedMs,
    changed: true,
  };
}

/**
 * What every recording goes through once the mic stops: trim, swap in the
 * trimmed blob + a fresh object URL, report what was saved. Falls back to
 * the untouched recording on any failure so the flow never blocks on this.
 */
export async function finalizeRecording<T extends Recording>(rec: T, context: TrimContext): Promise<T> {
  if (!rec.blob || rec.blob.size === 0) return rec;
  try {
    const res = await trimSilence(rec.blob);
    trackEvent("audio_trimmed", {
      context,
      changed: res.changed,
      inputMs: Math.round(rec.durationMs),
      outputMs: Math.round(res.durationMs),
      removedMs: Math.round(res.removedMs),
      inputBytes: rec.blob.size,
      outputBytes: res.blob.size,
    });
    if (!res.changed) return { ...rec, durationMs: res.durationMs || rec.durationMs };
    return {
      ...rec,
      blob: res.blob,
      url: rec.url !== undefined ? URL.createObjectURL(res.blob) : rec.url,
      durationMs: res.durationMs,
    };
  } catch (err) {
    captureException(err, { location: "audioTrim.finalizeRecording", context });
    return rec;
  }
}

import { decodeMono, encodeWav } from "@/lib/audioTrim";

/**
 * Re-encode a recording as 16-bit mono 16 kHz WAV. Inworld's cloning API takes
 * WAV or MP3 only, and the phone records Opus (webm) or AAC (mp4), so the
 * sample is transcoded here, on the device, before it goes up. Throws when the
 * blob can't be decoded (Playwright's fake recorder); callers decide the fallback.
 */
export async function toWav(blob: Blob): Promise<Blob> {
  const { pcm, sampleRate } = await decodeMono(blob);
  return encodeWav(pcm, sampleRate, [[0, pcm.length]]);
}

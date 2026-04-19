import type { SurveyQuestion } from "@/types/survey";

export interface MediaMix {
  hasVoice: boolean;
  hasPhoto: boolean;
  hasVideo: boolean;
  isVoiceOnly: boolean;
  isMixed: boolean;
  /** Short meta label for the Welcome screen badge row. */
  label: string;
  /** Noun phrase for copy like "Share your {noun}". */
  noun: string;
  /** Consent screen description sentence. */
  consentDescription: string;
  /** CTA label on Welcome / Consent buttons. */
  ctaLabel: string;
  /** Welcome screen description line. */
  welcomeDescription: string;
  /** Small footnote under the Welcome CTA. */
  securityFootnote: string;
  /** Human-readable time estimate, e.g. "~2 min" or "~3–5 min". */
  timeEstimate: string;
}

// Per-question time estimates in seconds. Empirical rough averages — photo
// capture is a few seconds of fiddling with the camera, voice is the average
// spoken answer length, video is ~45s recording + ~15s of setup. Change these
// if real usage data suggests otherwise.
const SECONDS_PER_QUESTION = {
  voice: 60,
  photo: 15,
  video: 60,
} as const;

function estimateSeconds(questions: SurveyQuestion[]): number {
  return questions.reduce((total, q) => {
    const type = q.type ?? "voice";
    return total + SECONDS_PER_QUESTION[type];
  }, 0);
}

function formatEstimate(seconds: number): string {
  // Under a minute — round to "< 1 min". Otherwise render as a ±30% range
  // so we don't over-promise. Voice answers especially vary a lot.
  if (seconds < 60) return "< 1 min";
  const minutes = seconds / 60;
  const lo = Math.max(1, Math.floor(minutes * 0.8));
  const hi = Math.max(lo + 1, Math.ceil(minutes * 1.3));
  if (lo === hi) return `~${lo} min`;
  return `~${lo}–${hi} min`;
}

/**
 * Inspect the question types in a survey and return copy + labels that match
 * the media mix. Keeps voice-only surveys worded like before and adapts when
 * photo/video questions are present.
 */
export function getMediaMix(questions: SurveyQuestion[]): MediaMix {
  const types = new Set(questions.map((q) => q.type ?? "voice"));
  const hasVoice = types.has("voice");
  const hasPhoto = types.has("photo");
  const hasVideo = types.has("video");
  const count = (hasVoice ? 1 : 0) + (hasPhoto ? 1 : 0) + (hasVideo ? 1 : 0);
  const isVoiceOnly = hasVoice && !hasPhoto && !hasVideo;
  const isMixed = count > 1;

  // Badge label for the Welcome meta row (replaces the old hardcoded "Voice only").
  let label: string;
  if (isVoiceOnly) {
    label = "Voice only";
  } else if (hasVoice && hasPhoto && hasVideo) {
    label = "Voice, photo & video";
  } else if (hasVoice && hasPhoto) {
    label = "Voice & photo";
  } else if (hasVoice && hasVideo) {
    label = "Voice & video";
  } else if (hasPhoto && hasVideo) {
    label = "Photo & video";
  } else if (hasPhoto) {
    label = "Photo only";
  } else if (hasVideo) {
    label = "Video only";
  } else {
    label = "Voice only"; // safe fallback
  }

  // Noun phrase — used in copy like "Share your {noun}".
  const noun = isVoiceOnly
    ? "thoughts by voice"
    : isMixed
    ? "answers — voice, photos, and video"
    : hasPhoto
    ? "answers with photos"
    : hasVideo
    ? "answers with video"
    : "thoughts by voice";

  // Welcome description — short sentence under the title.
  const welcomeDescription = isVoiceOnly
    ? "Share your thoughts by voice. No typing needed."
    : isMixed
    ? "Share your answers — some by voice, some with your camera."
    : hasPhoto
    ? "Answer with quick photos from your camera."
    : hasVideo
    ? "Answer with short videos from your camera."
    : "Share your thoughts by voice. No typing needed.";

  // Consent screen description.
  const consentDescription = isVoiceOnly
    ? "Your voice responses will be recorded and shared with the person who created this survey."
    : isMixed
    ? "Your responses — voice, photos, and video — will be recorded and shared with the person who created this survey."
    : hasPhoto && !hasVideo
    ? "Your photos and any voice responses will be shared with the person who created this survey."
    : hasVideo && !hasPhoto
    ? "Your videos and any voice responses will be shared with the person who created this survey."
    : "Your responses will be recorded and shared with the person who created this survey.";

  // CTA label — "Start recording" only makes sense for voice-only.
  const ctaLabel = isVoiceOnly
    ? "Start recording"
    : isMixed || hasPhoto || hasVideo
    ? "Let's start"
    : "Start recording";

  // Security footnote under the welcome CTA.
  const securityFootnote = isVoiceOnly
    ? "We'll record your voice answers securely"
    : "We'll store your answers securely";

  const timeEstimate = formatEstimate(estimateSeconds(questions));

  return {
    hasVoice,
    hasPhoto,
    hasVideo,
    isVoiceOnly,
    isMixed,
    label,
    noun,
    consentDescription,
    ctaLabel,
    welcomeDescription,
    securityFootnote,
    timeEstimate,
  };
}

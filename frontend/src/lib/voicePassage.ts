/**
 * The passage every creator reads out loud to clone their voice. The backend
 * sends the same words to Inworld as the sample's transcription, so this must
 * match `backend/src/services/voicePassage.ts` word for word (pitfall 32).
 */
export const VOICE_PASSAGE =
  "Halt, traveler! You carry the scent of blood and battle. I sense hesitation, and yet your eyes burn with resolve. Are you strong enough to claim what you seek?";

/** Inworld clones from 3 s and trims at 30 s; the passage takes about 12 s read aloud. */
export const VOICE_SAMPLE_MIN_MS = 3_000;
export const VOICE_SAMPLE_MAX_MS = 30_000;

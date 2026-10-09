import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "@/api/client";
import { captureException } from "@/lib/posthog";

/**
 * Live speech-to-text for the creator flow.
 *
 * Primary: the browser's Web Speech API (Chrome, Android Chrome, iOS Safari).
 * Interim results arrive within a few hundred milliseconds, which is what
 * makes the brief checklist tick while you're still mid-sentence.
 *
 * Fallback: Workers AI Whisper via POST /api/surveys/:id/transcribe. Used when
 * the API is missing (Firefox, Chromium builds without Google's speech
 * service, Playwright) or errors, or when the watchdog sees voice energy on
 * the mic but no words coming back. In `live` mode the fallback re-sends the
 * cumulative recording every few seconds; otherwise it transcribes once on
 * `stop()`.
 *
 * The hook never owns the microphone: the caller passes `getAudioBlob` (the
 * recording so far, from useVoiceRecorder) and the shared `analyser`.
 */

export type TranscriptSource = "speech" | "whisper" | null;

interface Options {
  surveyId: string;
  getAudioBlob: () => Blob | null;
  analyser: AnalyserNode | null;
  /** Poll Whisper while recording (brief screen) vs. transcribe once on stop. */
  live?: boolean;
  lang?: string;
}

const LIVE_POLL_MS = 4500;
/** Watchdog: switch to Whisper if we heard voice for this long with no words. */
const WATCHDOG_VOICE_MS = 2500;
const WATCHDOG_MIN_ELAPSED_MS = 8000;
const VOICE_RMS_THRESHOLD = 0.035;
const FATAL_SPEECH_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "network",
  "language-not-supported",
  "bad-grammar",
]);

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function useLiveTranscript({ surveyId, getAudioBlob, analyser, live = false, lang }: Options) {
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [source, setSource] = useState<TranscriptSource>(null);
  const [listening, setListening] = useState(false);

  const activeRef = useRef(false);
  const sourceRef = useRef<TranscriptSource>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /** Final text from earlier recognition sessions (Chrome restarts every ~60 s). */
  const committedRef = useRef("");
  /** Final text from the current recognition session. */
  const sessionFinalRef = useRef("");
  const interimRef = useRef("");
  const gotResultRef = useRef(false);
  const startedAtRef = useRef(0);
  const voiceMsRef = useRef(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whisper fallback state
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastSentBytesRef = useRef(0);
  const whisperTextRef = useRef("");

  const latestGetBlob = useRef(getAudioBlob);
  latestGetBlob.current = getAudioBlob;

  const publishSpeech = useCallback(() => {
    setFinalText(tidy(`${committedRef.current} ${sessionFinalRef.current}`));
    setInterimText(tidy(interimRef.current));
  }, []);

  // ── Whisper fallback ───────────────────────────────────────────────

  const transcribeSoFar = useCallback(async (force = false): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const blob = latestGetBlob.current();
    if (!blob || blob.size === 0) return;
    // Skip if nothing meaningful was recorded since the last round trip.
    if (!force && blob.size < lastSentBytesRef.current + 1500) return;

    const run = (async () => {
      try {
        const text = await transcribeAudio(surveyId, blob);
        lastSentBytesRef.current = blob.size;
        whisperTextRef.current = tidy(text);
        setFinalText(whisperTextRef.current);
        setInterimText("");
      } catch (err) {
        captureException(err, { location: "useLiveTranscript.transcribeSoFar" });
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [surveyId]);

  const startWhisper = useCallback(() => {
    sourceRef.current = "whisper";
    setSource("whisper");
    setListening(true);
    if (live && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => {
        if (!activeRef.current) return;
        void transcribeSoFar();
      }, LIVE_POLL_MS);
    }
  }, [live, transcribeSoFar]);

  // ── Web Speech ─────────────────────────────────────────────────────

  const stopSpeech = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {}
    }
  }, []);

  const switchToWhisper = useCallback(
    (reason: string) => {
      if (sourceRef.current === "whisper") return;
      console.warn(`[useLiveTranscript] falling back to Whisper: ${reason}`);
      // Keep whatever speech text we already have as a prefix so nothing is lost.
      const carried = tidy(`${committedRef.current} ${sessionFinalRef.current} ${interimRef.current}`);
      stopSpeech();
      whisperTextRef.current = carried;
      startWhisper();
    },
    [startWhisper, stopSpeech],
  );

  const startSpeechSession = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || !activeRef.current) return false;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = lang || (typeof navigator !== "undefined" && navigator.language) || "en-US";

    sessionFinalRef.current = "";
    interimRef.current = "";

    rec.onresult = (e: any) => {
      // Rebuild from the full results list every time. Chrome and Safari
      // disagree on what `resultIndex` means, but `results` is always the
      // whole session, so this is idempotent on both.
      let finals = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finals += `${t} `;
        else interim += `${t} `;
      }
      sessionFinalRef.current = finals;
      interimRef.current = interim;
      gotResultRef.current = true;
      publishSpeech();
    };

    rec.onerror = (e: any) => {
      const code = e?.error ?? "unknown";
      if (FATAL_SPEECH_ERRORS.has(code)) {
        switchToWhisper(`speech error ${code}`);
      }
      // "no-speech" and "aborted" are benign; onend will restart us.
    };

    rec.onend = () => {
      if (recRef.current !== rec) return;
      // Fold this session's finals into the running text and start a new one.
      committedRef.current = tidy(`${committedRef.current} ${sessionFinalRef.current}`);
      sessionFinalRef.current = "";
      interimRef.current = "";
      publishSpeech();
      if (activeRef.current && sourceRef.current === "speech") {
        restartTimerRef.current = setTimeout(() => {
          if (activeRef.current && sourceRef.current === "speech") startSpeechSession();
        }, 150);
      }
    };

    try {
      rec.start();
    } catch (err) {
      // Safari throws if a session is already running; try again shortly.
      restartTimerRef.current = setTimeout(() => {
        if (activeRef.current && sourceRef.current === "speech") startSpeechSession();
      }, 400);
    }
    recRef.current = rec;
    return true;
  }, [lang, publishSpeech, switchToWhisper]);

  // ── Watchdog: voice energy but no words → Whisper ───────────────────

  useEffect(() => {
    if (!listening || !analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    const tick = setInterval(() => {
      if (!activeRef.current || sourceRef.current !== "speech") return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      if (rms > VOICE_RMS_THRESHOLD) voiceMsRef.current += 250;
      const elapsed = Date.now() - startedAtRef.current;
      if (!gotResultRef.current && voiceMsRef.current >= WATCHDOG_VOICE_MS && elapsed >= WATCHDOG_MIN_ELAPSED_MS) {
        switchToWhisper("no words after voice activity");
      }
    }, 250);
    return () => clearInterval(tick);
  }, [listening, analyser, switchToWhisper]);

  // ── Public API ─────────────────────────────────────────────────────

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    startedAtRef.current = Date.now();
    voiceMsRef.current = 0;
    gotResultRef.current = false;
    lastSentBytesRef.current = 0;

    if (getSpeechRecognitionCtor()) {
      sourceRef.current = "speech";
      setSource("speech");
      setListening(true);
      startSpeechSession();
    } else {
      startWhisper();
    }
  }, [startSpeechSession, startWhisper]);

  /**
   * Stop listening and resolve with the best final transcript we have.
   * Speech: waits briefly for the engine to flush its last interim words.
   * Whisper: transcribes the complete recording one last time.
   */
  const stop = useCallback(async (): Promise<string> => {
    if (!activeRef.current) {
      return tidy(
        sourceRef.current === "whisper"
          ? whisperTextRef.current
          : `${committedRef.current} ${sessionFinalRef.current} ${interimRef.current}`,
      );
    }
    activeRef.current = false;

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    let text: string;
    if (sourceRef.current === "speech") {
      const rec = recRef.current;
      text = await new Promise<string>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve(tidy(`${committedRef.current} ${sessionFinalRef.current} ${interimRef.current}`));
        };
        if (!rec) return finish();
        rec.onend = finish;
        setTimeout(finish, 1200);
        try {
          rec.stop();
        } catch {
          finish();
        }
      });
      stopSpeech();
    } else {
      if (inFlightRef.current) await inFlightRef.current;
      await transcribeSoFar(true);
      text = whisperTextRef.current;
    }

    setListening(false);
    setFinalText(text);
    setInterimText("");
    return text;
  }, [stopSpeech, transcribeSoFar]);

  const reset = useCallback(() => {
    committedRef.current = "";
    sessionFinalRef.current = "";
    interimRef.current = "";
    whisperTextRef.current = "";
    lastSentBytesRef.current = 0;
    gotResultRef.current = false;
    voiceMsRef.current = 0;
    setFinalText("");
    setInterimText("");
  }, []);

  /**
   * Pre-load text that should come before anything we hear next, e.g. what
   * the creator typed before switching back to voice.
   */
  const seed = useCallback((prefix: string) => {
    const p = tidy(prefix);
    committedRef.current = p;
    sessionFinalRef.current = "";
    interimRef.current = "";
    whisperTextRef.current = p;
    setFinalText(p);
    setInterimText("");
  }, []);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      stopSpeech();
    };
  }, [stopSpeech]);

  const text = tidy(`${finalText} ${interimText}`);

  return { text, finalText, interimText, source, listening, start, stop, reset, seed };
}

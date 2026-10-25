import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import VoiceWave from "@/components/VoiceWave";
import VoiceNotePill from "@/components/VoiceNotePill";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { fadeUp, press, stagger, transitionLarge, transitionSmall } from "@/lib/animations";
import { trackEvent, captureException } from "@/lib/posthog";
import { finalizeRecording } from "@/lib/audioTrim";
import { toWav } from "@/lib/audioWav";
import { cloneVoice } from "@/api/client";
import { toast } from "@/components/ui/sonner";
import { VOICE_PASSAGE, VOICE_SAMPLE_MAX_MS, VOICE_SAMPLE_MIN_MS } from "@/lib/voicePassage";

/**
 * First step of creation: the creator reads one fixed passage out loud and
 * Inworld clones their voice from it in a few seconds. From then on anything
 * they type (the opener, later the agent's follow-ups) can be said as them.
 *
 * Tap to record, the take is trimmed and re-encoded as WAV on the phone, sent
 * up, and the clone comes back with a preview line so they hear themself say
 * something they never said. "That's me" continues; "Read it again" re-records.
 * Skipping is only offered when the mic is unavailable or the clone failed:
 * the voice is the point of this screen.
 */

interface VoiceSampleScreenProps {
  surveyId: string;
  /** `cloned` is false when the creator skipped (mic denied or the service failed). */
  onDone: (cloned: boolean) => void;
  onBack?: () => void;
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** The 72px tap-to-record control (see IntroScreen's history): accent fill, black glyph. */
const recordControlClass =
  "relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-color-1 text-badge-foreground transition-[background-color,color,box-shadow] hover:shadow-s focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none disabled:bg-muted disabled:text-neutral-6";

type Phase = "idle" | "recording" | "cloning" | "cloned";

export default function VoiceSampleScreen({ surveyId, onDone, onBack }: VoiceSampleScreenProps) {
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<{ url: string; durationMs: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopTimer();
    };
  }, []);

  const finishRecording = useCallback(async () => {
    stopTimer();
    const rec = await recorder.stop();
    if (rec.url) URL.revokeObjectURL(rec.url);
    if (rec.blob.size === 0) {
      setPhase("idle");
      return;
    }
    if (rec.durationMs < VOICE_SAMPLE_MIN_MS) {
      toast("A little longer. Read the whole passage through.");
      setPhase("idle");
      setElapsed(0);
      return;
    }

    setPhase("cloning");
    trackEvent("voice_sample_recorded", { durationMs: rec.durationMs });
    try {
      // Trim the silence either side, then WAV: Inworld takes WAV or MP3 only.
      const trimmed = await finalizeRecording({ blob: rec.blob, durationMs: rec.durationMs }, "sample");
      let sample: Blob;
      try {
        sample = await toWav(trimmed.blob);
      } catch (err) {
        // Undecodable here (no OfflineAudioContext); let the server decide.
        captureException(err, { location: "VoiceSampleScreen.toWav" });
        sample = trimmed.blob;
      }
      const result = await cloneVoice(surveyId, sample);
      if (!mountedRef.current) return;
      trackEvent("voice_cloned", { surveyId, preview: !!result.preview, sampleBytes: sample.size });
      setPreview(result.preview ? { url: result.preview.audioUrl, durationMs: result.preview.durationMs } : null);
      setFailed(false);
      setPhase("cloned");
    } catch (err) {
      if (!mountedRef.current) return;
      captureException(err, { location: "VoiceSampleScreen.cloneVoice" });
      trackEvent("voice_clone_failed");
      toast.error("Couldn't clone your voice just now. Try once more, or skip for now.");
      setFailed(true);
      setPhase("idle");
      setElapsed(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId]);

  const startRecording = async () => {
    if (isTransitioning || phase === "cloning") return;
    setElapsed(0);
    setPreview(null);
    const ok = await recorder.start();
    if (!ok) return;
    setPhase("recording");
    trackEvent("voice_sample_started");
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= VOICE_SAMPLE_MAX_MS) void finishRecording();
    }, 100);
  };

  const handleContinue = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    onDone(true);
  };

  const handleSkip = async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    stopTimer();
    if (recorder.isRecording) await recorder.stop();
    trackEvent("voice_sample_skipped", { reason: recorder.permissionDenied ? "mic" : "failed" });
    onDone(false);
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    stopTimer();
    if (recorder.isRecording) await recorder.stop();
    onBack();
  };

  const micDenied = recorder.permissionDenied;
  const canSkip = micDenied || failed;
  const remaining = Math.max(0, VOICE_SAMPLE_MAX_MS - elapsed);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-background" data-testid="voice-sample">
      {/* Top bar */}
      <motion.div
        className="flex items-center gap-xs px-l pt-xxl pb-xxs shrink-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        {onBack && (
          <Button type="button" variant="ghost" size="icon" onClick={handleBack} aria-label="Back" className="-ml-xs">
            <ChevronLeft className="!size-6" aria-hidden />
          </Button>
        )}
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
          Step 1 · Your voice
        </span>
        <div className="flex-1" />
        {phase === "recording" && (
          <motion.div
            className="flex items-center gap-xs rounded-full bg-card px-s py-xxs"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={transitionSmall}
          >
            <span className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
            <span
              className={`font-data text-s font-medium tabular-nums ${remaining <= 5_000 ? "text-error" : "text-color-1"}`}
            >
              {formatDuration(elapsed)}
            </span>
          </motion.div>
        )}
      </motion.div>

      {/* Heading + the passage */}
      <motion.div className="px-l pt-xxs shrink-0" variants={stagger} initial="initial" animate="animate">
        <motion.h2 variants={fadeUp} className="font-editorial text-l sm:text-xl font-medium text-foreground">
          {phase === "cloned" ? "Here's your voice" : "Read this out loud"}
        </motion.h2>
        <motion.p variants={fadeUp} className="mt-xs text-s text-muted-foreground">
          {phase === "cloned"
            ? "You never said this. From now on, anything you type can be said as you."
            : "Your agent will speak to the group as you. Tap, read the passage, tap again. About ten seconds."}
        </motion.p>

        <motion.blockquote
          variants={fadeUp}
          className={`mt-m rounded-m bg-card px-m py-m font-editorial text-m sm:text-l font-medium text-foreground transition-opacity duration-large ease-large ${
            phase === "cloned" ? "opacity-50" : ""
          }`}
          data-testid="voice-passage"
        >
          {VOICE_PASSAGE}
        </motion.blockquote>
      </motion.div>

      <div className="flex-1 min-h-0" />

      {/* Recorder / preview + CTA */}
      <motion.div
        className="flex flex-col items-center gap-s px-l pt-xs pb-safe shrink-0"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {micDenied && (
          <motion.div
            variants={fadeUp}
            className="w-full rounded-s bg-card px-m py-xs text-center text-xs text-muted-foreground"
          >
            Mic unavailable. You can clone your voice later from your profile.
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {phase === "cloned" && preview ? (
            <motion.div
              key="preview"
              className="w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: transitionSmall }}
              transition={transitionSmall}
              data-testid="voice-preview"
            >
              <VoiceNotePill url={preview.url} durationMs={preview.durationMs} />
            </motion.div>
          ) : phase === "cloning" ? (
            <motion.div
              key="cloning"
              className="flex h-10 items-center gap-xs text-s text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: transitionSmall }}
              transition={transitionSmall}
              data-testid="voice-cloning"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Cloning your voice…
            </motion.div>
          ) : (
            <motion.div
              key="waveform"
              className="w-full h-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: transitionSmall }}
              transition={transitionSmall}
            >
              <VoiceWave analyser={recorder.analyser} isRecording={recorder.isRecording} />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.p variants={fadeUp} className="text-xs text-center text-muted-foreground">
          {phase === "recording"
            ? "Reading… tap Stop when you reach the end"
            : phase === "cloning"
            ? "A few seconds"
            : phase === "cloned"
            ? preview
              ? "Play it. If it doesn't sound like you, read it again."
              : "Cloned. The preview didn't come through, but your voice is saved."
            : "Tap to start, read, tap to stop"}
        </motion.p>

        {phase === "cloned" ? (
          <motion.div variants={fadeUp} className="w-full flex flex-col items-center gap-xs">
            <Button size="lg" className="w-full" onClick={handleContinue} disabled={isTransitioning} data-testid="voice-continue">
              That's me
            </Button>
            <Button type="button" variant="link" size="sm" onClick={startRecording} disabled={isTransitioning} data-testid="voice-retry">
              Read it again
            </Button>
          </motion.div>
        ) : (
          <motion.div variants={fadeUp} className="relative flex items-center justify-center">
            {phase === "recording" && (
              <span
                className="absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_var(--color-1-transparent)] pulse-ring"
                aria-hidden
              />
            )}
            {phase === "recording" ? (
              <motion.button
                type="button"
                onClick={finishRecording}
                data-testid="voice-stop"
                aria-label="Stop"
                className={recordControlClass}
                whileTap={press}
              >
                <Square size={24} fill="currentColor" aria-hidden />
              </motion.button>
            ) : (
              <motion.button
                type="button"
                onClick={startRecording}
                disabled={micDenied || isTransitioning || phase === "cloning"}
                data-testid="voice-record"
                aria-label="Record the passage"
                className={recordControlClass}
                whileTap={press}
              >
                <Mic size={28} aria-hidden />
              </motion.button>
            )}
          </motion.div>
        )}

        {canSkip && phase !== "cloned" && (
          <motion.div variants={fadeUp}>
            <Button type="button" variant="link" size="sm" onClick={handleSkip} disabled={isTransitioning} data-testid="voice-skip">
              Skip for now
            </Button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

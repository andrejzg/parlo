import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import VoiceWave from "@/components/VoiceWave";
import VoiceNotePill from "@/components/VoiceNotePill";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { fadeUp, press, stagger, transitionLarge, transitionSmall } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";

/**
 * Last creative step: the creator records a short hello that participants
 * hear on the welcome screen before the first question. A real voice is the
 * thing that gets busy people to actually answer, so we ask for it right
 * after they've agreed on the questions — while they're still in the mood.
 *
 * Tap to record (unlike the brief, this one is a small performance and people
 * want a beat to think), 60 s cap, playback + re-record, and a skip link so
 * it never blocks the share link.
 */

export interface IntroResult {
  blob: Blob;
  durationMs: number;
}

interface IntroScreenProps {
  onContinue: (intro: IntroResult | null) => void;
  onBack?: () => void;
}

const MAX_MS = 60_000;

const PROMPTS = [
  "Who you are",
  "Why you're asking them",
  "What you'll do with it",
];

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** The 72px tap-to-record control: accent fill with the theme's accent
 *  foreground glyph. Mirrors the shared Button's press, focus and disabled
 *  treatment; the size is the control's touch target, not a theme step. */
const recordControlClass =
  "relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-color-1 text-badge-foreground transition-[background-color,color,box-shadow] hover:shadow-s focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none disabled:bg-muted disabled:text-neutral-6";

type Phase = "idle" | "recording" | "recorded";

export default function IntroScreen({ onContinue, onBack }: IntroScreenProps) {
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; durationMs: number } | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const takeUrlRef = useRef<string | null>(null);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const finishRecording = useCallback(async () => {
    stopTimer();
    const rec = await recorder.stop();
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = rec.url;
    if (rec.blob.size > 0) {
      setTake({ blob: rec.blob, url: rec.url, durationMs: rec.durationMs });
      setPhase("recorded");
      trackEvent("intro_recorded", { durationMs: rec.durationMs });
    } else {
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    if (isTransitioning) return;
    setElapsed(0);
    const ok = await recorder.start();
    if (!ok) return;
    setPhase("recording");
    trackEvent("intro_recording_started");
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_MS) void finishRecording();
    }, 100);
  };

  const discardTake = () => {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTake(null);
    setPhase("idle");
    setElapsed(0);
  };

  useEffect(() => {
    return () => {
      stopTimer();
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    };
  }, []);

  const handleUse = () => {
    if (!take || isTransitioning) return;
    setIsTransitioning(true);
    // The parent uploads it — don't revoke the URL, it's gone from here anyway.
    takeUrlRef.current = null;
    onContinue({ blob: take.blob, durationMs: take.durationMs });
  };

  const handleSkip = async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    stopTimer();
    if (recorder.isRecording) await recorder.stop();
    trackEvent("intro_skipped", { phase });
    onContinue(null);
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    stopTimer();
    if (recorder.isRecording) await recorder.stop();
    onBack();
  };

  const micDenied = recorder.permissionDenied;
  const remaining = Math.max(0, MAX_MS - elapsed);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-background">
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
          Last step · Say hello
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
              className={`font-data text-s font-medium tabular-nums ${remaining <= 10_000 ? "text-error" : "text-color-1"}`}
            >
              {formatDuration(elapsed)}
            </span>
          </motion.div>
        )}
      </motion.div>

      {/* Heading + prompts */}
      <motion.div className="px-l pt-xxs shrink-0" variants={stagger} initial="initial" animate="animate">
        <motion.h2 variants={fadeUp} className="font-editorial text-l sm:text-xl font-medium text-foreground">
          Say hi to the people you're about to ask
        </motion.h2>
        <motion.p variants={fadeUp} className="mt-xs text-s text-muted-foreground">
          They'll hear this before the first question. A real voice is what gets busy people to answer. Under a minute.
        </motion.p>

        <motion.ul className="flex flex-col gap-xs mt-s list-none" aria-label="What to mention">
          {PROMPTS.map((text, i) => (
            <motion.li
              key={text}
              variants={fadeUp}
              className="flex items-center gap-s rounded-s bg-card px-s py-xs"
            >
              <span
                className="flex h-l w-l shrink-0 items-center justify-center rounded-full bg-muted font-data text-xxs font-medium tabular-nums text-muted-foreground"
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="text-s font-medium text-neutral-8">{text}</span>
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>

      <div className="flex-1 min-h-0" />

      {/* Recorder / playback + CTA */}
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
            Mic unavailable — you can add a hello later from the dashboard
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {phase === "recorded" && take ? (
            <motion.div
              key="take"
              className="w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: transitionSmall }}
              transition={transitionSmall}
              data-testid="intro-take"
            >
              <VoiceNotePill url={take.url} durationMs={take.durationMs} onDelete={discardTake} />
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
            ? "Recording — tap Stop when you're done"
            : phase === "recorded"
            ? "Listen back, or tap the bin to try again"
            : "Tap to start, we'll stop at a minute"}
        </motion.p>

        {phase === "recorded" ? (
          <motion.div variants={fadeUp} className="w-full">
            <Button
              size="lg"
              className="w-full"
              onClick={handleUse}
              disabled={isTransitioning}
              data-testid="intro-use"
            >
              Use this hello
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
                data-testid="intro-stop"
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
                disabled={micDenied || isTransitioning}
                data-testid="intro-record"
                aria-label="Record a hello"
                className={recordControlClass}
                whileTap={press}
              >
                <Mic size={28} aria-hidden />
              </motion.button>
            )}
          </motion.div>
        )}

        <motion.div variants={fadeUp}>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={handleSkip}
            disabled={isTransitioning}
            data-testid="intro-skip"
          >
            Skip for now
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}

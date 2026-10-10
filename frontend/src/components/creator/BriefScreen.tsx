import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Keyboard, Mic } from "lucide-react";
import VoiceWave from "@/components/VoiceWave";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BriefChecklistList, BriefStack } from "@/components/creator/BriefChecklist";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useLiveTranscript, type TranscriptSource } from "@/hooks/useLiveTranscript";
import { useBriefChecklist } from "@/hooks/useBriefChecklist";
import { stagger, fadeUp, transitionSmall, transitionLarge } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";

/**
 * Step 1 of creating an agent: one screen where the creator describes the
 * research agent they want, in their own words, while five checklist items
 * tick green as TypeSafe Jev hears them covered. Single screen, phone-first.
 *
 * Two modes, switchable at any point without losing a word:
 * - voice: mic auto-starts, the full five-item list ticks live, the heard
 *   words show as a live transcript.
 * - text: a textarea, and the checklist as a stack of cards — one item at a
 *   time on top of the screen, the next coming forward as Jev ticks the one
 *   on show.
 * Switching voice → text keeps the heard words in the textarea; text → voice
 * seeds the transcript with what was typed. The checklist state lives above
 * both, so ticks carry across.
 */

export interface BriefResult {
  transcript: string;
  blob?: Blob;
  durationMs: number;
  mode: "voice" | "text";
  source: TranscriptSource | "text";
}

interface BriefScreenProps {
  surveyId: string;
  onContinue: (result: BriefResult) => void;
  onBack?: () => void;
  initialMode?: "voice" | "text";
  /** Pre-fill (e.g. coming back from a follow-up question). */
  initialTranscript?: string;
  /** Parent is fetching the first follow-up question — show a spinner on the CTA. */
  busy?: boolean;
}

const MIN_TICKS_TO_SKIP = 3;

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function BriefScreen({
  surveyId,
  onContinue,
  onBack,
  initialMode = "voice",
  initialTranscript = "",
  busy = false,
}: BriefScreenProps) {
  const recorder = useVoiceRecorder();
  const transcript = useLiveTranscript({
    surveyId,
    getAudioBlob: recorder.getRecordedBlob,
    analyser: recorder.analyser,
    live: true,
  });

  const [mode, setMode] = useState<"voice" | "text">(initialMode);
  const [textValue, setTextValue] = useState(initialTranscript);
  const [elapsed, setElapsed] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [micDeniedNotice, setMicDeniedNotice] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mountedAtRef = useRef(Date.now());

  const effectiveText = mode === "voice" ? transcript.text : textValue;
  const checklist = useBriefChecklist(surveyId, effectiveText);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((e) => e + 100), 100);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const beginVoice = useCallback(async () => {
    const ok = await recorder.start();
    if (!ok) return false;
    // The creator tapped the keyboard while the mic was still warming up:
    // don't leave a recorder running behind the textarea.
    if (modeRef.current !== "voice") {
      await recorder.stop();
      return false;
    }
    setHasStarted(true);
    transcript.start();
    startTimer();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start the mic on mount (voice mode only).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (initialMode === "text") return;
    if (initialTranscript) transcript.seed(initialTranscript);
    void beginVoice();
    return () => stopTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mic denied → fall back to typing.
  useEffect(() => {
    if (recorder.permissionDenied && mode === "voice") {
      setMicDeniedNotice(true);
      void switchToText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.permissionDenied]);

  useEffect(() => {
    if (mode === "text") textareaRef.current?.focus();
  }, [mode]);

  // Analytics: ticks and completion.
  const tickedRef = useRef<Set<string>>(new Set());
  const completedRef = useRef(false);
  useEffect(() => {
    for (const entry of checklist.items) {
      if (entry.satisfied && !tickedRef.current.has(entry.id)) {
        tickedRef.current.add(entry.id);
        trackEvent("brief_item_ticked", { item: entry.id, elapsedMs: Date.now() - mountedAtRef.current, mode });
      }
    }
    if (checklist.complete && !completedRef.current) {
      completedRef.current = true;
      trackEvent("brief_completed", {
        elapsedMs: Date.now() - mountedAtRef.current,
        mode,
        source: mode === "voice" ? transcript.source : "text",
        chars: effectiveText.length,
      });
    }
  }, [checklist.items, checklist.complete, mode, transcript.source, effectiveText.length]);

  /** Voice → text. Everything heard so far (which already includes anything typed earlier) lands in the textarea. */
  const switchToText = async () => {
    if (modeRef.current === "text") return;
    stopTimer();
    setMode("text");
    let heard = transcript.text;
    if (recorder.isRecording) {
      await recorder.stop();
      heard = await transcript.stop();
    }
    setTextValue((prev) => (heard.trim() ? heard : prev));
    trackEvent("brief_mode_switched", { to: "text", chars: heard.length, ticks: checklist.satisfiedCount });
  };

  /** Text → voice. What was typed becomes the start of the transcript; the mic picks up from there. */
  const switchToVoice = async () => {
    if (modeRef.current === "voice") return;
    setMicDeniedNotice(false);
    setMode("voice");
    transcript.seed(textValue);
    setElapsed(0);
    trackEvent("brief_mode_switched", { to: "voice", chars: textValue.length, ticks: checklist.satisfiedCount });
    await beginVoice();
  };

  const handleContinue = async () => {
    if (isTransitioning || busy) return;
    setIsTransitioning(true);

    if (mode === "text") {
      // Keep any recording made before switching to typing — it's archived for later.
      const blob = recorder.getRecordedBlob();
      onContinue({
        transcript: textValue.trim(),
        blob: blob && blob.size > 0 ? blob : undefined,
        durationMs: blob && blob.size > 0 ? elapsed : 0,
        mode: "text",
        source: "text",
      });
      return;
    }

    stopTimer();
    const rec = await recorder.stop();
    const text = await transcript.stop();
    onContinue({
      transcript: (text || transcript.text).trim(),
      blob: rec.blob.size > 0 ? rec.blob : undefined,
      durationMs: rec.durationMs,
      mode: "voice",
      source: transcript.source ?? "speech",
    });
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    stopTimer();
    if (recorder.isRecording) {
      await recorder.stop();
      await transcript.stop();
    }
    onBack();
  };

  const hasText = effectiveText.trim().length > 0;
  const canContinue = checklist.complete && hasText && !isTransitioning && !busy;
  const canSkip =
    !checklist.complete && checklist.satisfiedCount >= MIN_TICKS_TO_SKIP && hasText && !isTransitioning && !busy;

  // Show the tail of the transcript so the newest words are always visible.
  const TAIL = 150;
  const tail = effectiveText.length > TAIL ? `…${effectiveText.slice(-TAIL)}` : effectiveText;

  return (
    // Sized to fit a 667px-tall phone without scrolling; on anything shorter
    // (320×568 iPhone SE) the column scrolls rather than clipping the CTA.
    <div className="flex flex-col h-full overflow-y-auto bg-background" data-mode={mode}>
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
          Step 1 · Your brief
        </span>
        <div className="flex-1" />
        {mode === "voice" && recorder.isRecording && (
          <motion.div
            className="flex items-center gap-xs rounded-full bg-card px-s py-xxs"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={transitionSmall}
          >
            <span className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
            <span className="font-data text-s font-medium tabular-nums text-color-1">{formatDuration(elapsed)}</span>
          </motion.div>
        )}
      </motion.div>

      {/* Heading + checklist */}
      <motion.div className="px-l pt-xxs shrink-0" variants={stagger} initial="initial" animate="animate">
        <motion.h2 variants={fadeUp} className="font-editorial text-l sm:text-xl font-medium text-foreground">
          Describe your research agent
        </motion.h2>
        {/* Each mode's block is its own animation root so it also fades in
            when mounted later by a mode switch, not just with the screen. */}
        {mode === "voice" ? (
          <motion.div key="voice-list" variants={stagger} initial="initial" animate="animate">
            <motion.p variants={fadeUp} className="mt-xs text-s text-muted-foreground">
              Talk it through like you would to a colleague. I'll tick things off as you go.
            </motion.p>
            <div className="mt-s">
              <BriefChecklistList items={checklist.items} />
            </div>
          </motion.div>
        ) : (
          <motion.div key="type-stack" variants={fadeUp} initial="initial" animate="animate" className="mt-s">
            <BriefStack items={checklist.items} />
          </motion.div>
        )}
      </motion.div>

      {/* Live transcript (voice) — flexible, collapses on short screens.
          The line clamp is structural: it keeps the newest words visible. */}
      <div className="flex-1 min-h-0 px-l pt-xs flex flex-col justify-end overflow-hidden">
        {mode === "voice" && (
          <p
            className="text-s text-muted-foreground"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            aria-live="polite"
            data-testid="brief-transcript"
          >
            {hasText ? (
              <>
                {tail}
                {checklist.evaluating && (
                  <span className="inline-block w-1.5 h-1.5 ml-xs rounded-full bg-color-1 rec-blink align-middle" />
                )}
              </>
            ) : transcript.listening ? (
              <span className="text-neutral-6">Listening…</span>
            ) : null}
          </p>
        )}
      </div>

      {/* Input + mode switch + CTA */}
      <motion.div
        className="flex flex-col items-center gap-s px-l pt-xs pb-safe shrink-0"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {micDeniedNotice && mode === "text" && (
          <motion.div
            variants={fadeUp}
            className="w-full text-center text-xs text-muted-foreground rounded-s bg-card px-m py-xs"
          >
            Mic unavailable — type your brief instead
          </motion.div>
        )}

        {/* The input and, beside it, the way into the other mode. */}
        <div className="w-full flex items-end gap-s">
          <AnimatePresence mode="wait" initial={false}>
            {mode === "voice" ? (
              <motion.div
                key="waveform"
                className="min-w-0 flex-1 h-11"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: transitionLarge }}
                exit={{ opacity: 0, transition: transitionSmall }}
              >
                <VoiceWave analyser={recorder.analyser} isRecording={recorder.isRecording} />
              </motion.div>
            ) : (
              <motion.div
                key="textarea"
                className="min-w-0 flex-1"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: transitionLarge }}
                exit={{ opacity: 0, transition: transitionSmall }}
              >
                <Textarea
                  ref={textareaRef}
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="Who you'll talk to, what you want to learn, why, the tone, how long…"
                  rows={5}
                  data-testid="brief-textarea"
                />
              </motion.div>
            )}
          </AnimatePresence>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="shrink-0"
            onClick={mode === "voice" ? switchToText : switchToVoice}
            aria-label={mode === "voice" ? "Type instead" : "Switch to voice"}
            data-testid="brief-mode-toggle"
          >
            {mode === "voice" ? <Keyboard className="!size-5" aria-hidden /> : <Mic className="!size-5" aria-hidden />}
          </Button>
        </div>

        {mode === "voice" && (
          <motion.p variants={fadeUp} className="text-xs text-muted-foreground">
            {!hasStarted ? "Starting microphone…" : recorder.isRecording ? "Recording — speak naturally" : "Preparing…"}
          </motion.p>
        )}

        {canSkip && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transitionSmall}>
            <Button type="button" variant="link" size="sm" onClick={handleContinue}>
              Continue without the rest
            </Button>
          </motion.div>
        )}

        <motion.div variants={fadeUp} className="w-full">
          <Button
            size="lg"
            className="w-full"
            onClick={handleContinue}
            disabled={!canContinue}
            data-testid="brief-continue"
          >
            {busy ? "Thinking…" : checklist.complete ? "Continue" : `Continue · ${checklist.satisfiedCount}/${checklist.items.length}`}
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}

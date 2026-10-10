import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronLeft, Keyboard, Mic } from "lucide-react";
import VoiceWave from "@/components/VoiceWave";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useLiveTranscript } from "@/hooks/useLiveTranscript";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { VoiceAnswer } from "@/types/survey";
import { stagger, fadeUp, questionFadeUp, transitionSmall, transitionLarge } from "@/lib/animations";

interface CreationQuestion {
  id: string;
  text: string;
  subtext?: string | null;
}

interface CreationQuestionScreenProps {
  question: CreationQuestion;
  questionIndex: number;
  totalQuestions: number;
  isLast: boolean;
  existingAnswer?: VoiceAnswer;
  onNext: (answer: VoiceAnswer) => void;
  onBack?: () => void;
  /** If the user chose text mode on a previous question, start in text mode */
  initialMode?: "voice" | "text";
  /** Step chips for a fixed sequence (legacy audience/gather flow). Hidden when omitted. */
  stepLabels?: string[];
  /** Small label in the top bar, e.g. "Follow-up 3". */
  progressLabel?: string;
  ctaLabel?: string;
  /**
   * When set, a live transcript is captured while recording and returned as
   * `answer.transcript`, so the parent can act on the words immediately
   * (Cerebras picks the next question from them) without a server round trip.
   */
  transcriptSurveyId?: string;
  /** Parent is working (fetching the next question) — CTA shows a waiting label. */
  busy?: boolean;
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** The step-chip tick popping in: theme small-motion duration with a light bounce. */
const tickPop = { type: "spring" as const, visualDuration: 0.2, bounce: 0.2 };

/** Legacy two-question setup flow (still used by the MCP server's prompts). */
export const CREATION_QUESTIONS: CreationQuestion[] = [
  {
    id: "audience",
    text: "Who will I be talking to?",
    subtext: "Describe your audience — customers, teammates, leads...",
  },
  {
    id: "gather",
    text: "What info do you need me to gather?",
    subtext: "Tell me the key things you want to learn.",
  },
];

export default function CreationQuestionScreen({
  question,
  questionIndex,
  totalQuestions,
  isLast,
  existingAnswer,
  onNext,
  onBack,
  initialMode = "voice",
  stepLabels,
  progressLabel,
  ctaLabel,
  transcriptSurveyId,
  busy = false,
}: CreationQuestionScreenProps) {
  const { isRecording, analyser, permissionDenied, start, stop, getRecordedBlob } = useVoiceRecorder();
  const transcript = useLiveTranscript({
    surveyId: transcriptSurveyId ?? "",
    getAudioBlob: getRecordedBlob,
    analyser,
    live: false,
  });
  const captureTranscript = !!transcriptSurveyId;

  const [elapsed, setElapsed] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mode, setMode] = useState<"voice" | "text">(initialMode);
  const [textValue, setTextValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Restore existing text answer when revisiting
  useEffect(() => {
    if (existingAnswer?.textContent) {
      setMode("text");
      setTextValue(existingAnswer.textContent);
    }
  }, [existingAnswer]);

  const beginVoice = async () => {
    const ok = await start();
    if (ok) {
      setHasStarted(true);
      if (captureTranscript) transcript.start();
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 100);
      }, 100);
    }
    return ok;
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // Don't auto-start mic if we're in text mode (or restoring a typed answer)
    if (initialMode === "text" || existingAnswer?.textContent) return;
    void beginVoice();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchToText = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    let heard = "";
    if (isRecording) {
      await stop();
      if (captureTranscript) heard = await transcript.stop();
    }
    if (heard.trim()) setTextValue((prev) => prev || heard);
    setMode("text");
  };

  // Auto-switch to text mode when mic permission is denied
  const [micDeniedNotice, setMicDeniedNotice] = useState(false);
  useEffect(() => {
    if (permissionDenied && mode === "voice") {
      setMicDeniedNotice(true);
      switchToText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionDenied]);

  // Focus textarea when switching to text mode
  useEffect(() => {
    if (mode === "text") {
      textareaRef.current?.focus();
    }
  }, [mode]);

  const switchToVoice = async () => {
    setTextValue("");
    setMode("voice");
    setMicDeniedNotice(false);
    setElapsed(0);
    transcript.reset();
    await beginVoice();
  };

  const handleNext = async () => {
    if (isTransitioning || busy) return;
    setIsTransitioning(true);

    if (mode === "text") {
      onNext({
        questionId: question.id,
        durationMs: 0,
        textContent: textValue.trim(),
      });
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      const result = await stop();
      const text = captureTranscript ? await transcript.stop() : undefined;
      onNext({
        questionId: question.id,
        blob: result.blob,
        url: result.url,
        durationMs: result.durationMs,
        transcript: text,
      });
    }
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) {
      await stop();
      if (captureTranscript) await transcript.stop();
    }
    onBack();
  };

  const canSubmit =
    (mode === "voice"
      ? hasStarted && !isTransitioning
      : textValue.trim().length > 0 && !isTransitioning) && !busy;

  const swipe = useSwipeNavigation({
    onSwipeLeft: canSubmit ? handleNext : undefined,
    onSwipeRight: onBack ? handleBack : undefined,
    enabled: !isTransitioning,
  });

  const TAIL = 140;
  const liveText = transcript.text;
  const liveTail = liveText.length > TAIL ? `…${liveText.slice(-TAIL)}` : liveText;

  return (
    <div
      className="flex flex-col h-full bg-background"
      onTouchStart={swipe.onTouchStart}
      onTouchEnd={swipe.onTouchEnd}
    >
      {/* Top bar */}
      <motion.div
        className="flex flex-col gap-s px-l pt-xxl pb-s"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        <div className="flex items-center gap-xs">
          {/* Back button */}
          {onBack && (
            <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={transitionSmall}>
              <Button type="button" variant="ghost" size="icon" onClick={handleBack} aria-label="Back" className="-ml-xs">
                <ChevronLeft className="!size-6" aria-hidden />
              </Button>
            </motion.div>
          )}

          {progressLabel && (
            <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
              {progressLabel}
            </span>
          )}

          {stepLabels?.map((label, i) => {
            const isDone = i < questionIndex;
            const isActive = i === questionIndex;
            return (
              <motion.div
                key={i}
                className={`flex items-center gap-xs rounded-full px-s py-xxs text-xs font-medium ${
                  isDone || isActive ? "bg-color-1-transparent text-color-1" : "bg-muted text-muted-foreground"
                }`}
                animate={{
                  opacity: isDone || isActive ? 1 : 0.35,
                }}
                transition={transitionSmall}
              >
                {isDone ? (
                  <motion.span className="flex" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={tickPop}>
                    <Check size={11} aria-hidden />
                  </motion.span>
                ) : (
                  <span className="font-data text-xxs tabular-nums">{i + 1}</span>
                )}
                {label}
              </motion.div>
            );
          })}

          {/* Recording timer — pushed right */}
          <div className="flex-1" />
          {mode === "voice" && isRecording && (
            <motion.div
              className="flex items-center gap-xs rounded-full bg-card px-s py-xxs"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={transitionSmall}
            >
              <span className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
              <span className="font-data text-s font-medium tabular-nums text-color-1">
                {formatDuration(elapsed)}
              </span>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Question — centre stage. The block scrolls rather than hiding the hint behind the CTA. */}
      <motion.div
        className="flex-1 min-h-0 flex flex-col px-l overflow-y-auto"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* my-auto centres when there's room and scrolls from the top when there isn't */}
        <div className="my-auto py-xs flex flex-col items-start gap-m">
          <motion.h2
            variants={questionFadeUp}
            className="font-editorial text-l sm:text-xl font-medium text-foreground"
            data-testid="creation-question"
          >
            {question.text}
          </motion.h2>

          {question.subtext && (
            <motion.p variants={fadeUp} className="text-m text-neutral-8">
              {question.subtext}
            </motion.p>
          )}
        </div>
      </motion.div>

      {/* Wave / Textarea + CTA */}
      <motion.div
        className="flex flex-col items-center gap-m px-l pb-safe"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {micDeniedNotice && mode === "text" && (
          <motion.div
            variants={fadeUp}
            className="w-full text-center text-xs text-muted-foreground rounded-s bg-card px-m py-xs"
          >
            Mic unavailable — type your answer instead
          </motion.div>
        )}

        {/* Live transcript tail (creator follow-ups). The line clamp is structural:
            it keeps the newest words visible. */}
        {captureTranscript && mode === "voice" && liveText && (
          <p
            className="w-full text-s text-muted-foreground"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            aria-live="polite"
            data-testid="live-transcript"
          >
            {liveTail}
          </p>
        )}

        {/* Waveform or Textarea */}
        <AnimatePresence mode="wait">
          {mode === "voice" ? (
            <motion.div
              key="waveform"
              variants={fadeUp}
              className="w-full h-16"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: transitionSmall }}
            >
              <VoiceWave analyser={analyser} isRecording={isRecording} />
            </motion.div>
          ) : (
            <motion.div
              key="textarea"
              className="w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: transitionLarge }}
              exit={{ opacity: 0, transition: transitionSmall }}
            >
              <Textarea
                ref={textareaRef}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder="Type your answer..."
                rows={4}
                data-testid="creation-textarea"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status text (voice mode only) */}
        {mode === "voice" && (
          <motion.p variants={fadeUp} className="text-xs text-muted-foreground">
            {!hasStarted
              ? "Starting microphone..."
              : isRecording
              ? "Recording — speak naturally"
              : "Preparing..."}
          </motion.p>
        )}

        {/* Escape hatch toggle */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { ...transitionLarge, delay: 0.4 } }}>
          <Button type="button" variant="outline" size="sm" onClick={mode === "voice" ? switchToText : switchToVoice}>
            {mode === "voice" ? (
              <>
                <Keyboard size={16} aria-hidden />
                Type instead?
              </>
            ) : (
              <>
                <Mic size={16} aria-hidden />
                Switch to voice
              </>
            )}
          </Button>
        </motion.div>

        {/* CTA */}
        <motion.div variants={fadeUp} className="w-full">
          <Button
            size="lg"
            className="w-full"
            onClick={handleNext}
            disabled={!canSubmit}
            data-testid="creation-next"
          >
            {busy ? "Thinking…" : ctaLabel ?? (isLast ? "Finish" : "Next")}
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}

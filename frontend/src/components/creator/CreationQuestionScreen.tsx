import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import VoiceWave from "@/components/VoiceWave";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { VoiceAnswer } from "@/types/survey";

interface CreationQuestion {
  id: string;
  text: string;
  subtext?: string;
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
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};

const item = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

const questionItem = {
  initial: { opacity: 0, y: 28 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

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
}: CreationQuestionScreenProps) {
  const { isRecording, analyser, permissionDenied, start, stop } = useVoiceRecorder();
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

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    // Don't auto-start mic if we're in text mode
    if (initialMode === "text") return;
    const autoStart = async () => {
      const ok = await start();
      if (ok) {
        setHasStarted(true);
        timerRef.current = setInterval(() => {
          setElapsed((e) => e + 100);
        }, 100);
      }
    };
    autoStart();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchToText = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) await stop();
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
    const ok = await start();
    if (ok) {
      setHasStarted(true);
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 100);
      }, 100);
    }
  };

  const handleNext = async () => {
    if (isTransitioning) return;
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
      onNext({
        questionId: question.id,
        blob: result.blob,
        url: result.url,
        durationMs: result.durationMs,
      });
    }
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) await stop();
    onBack();
  };

  const canSubmit =
    mode === "voice"
      ? hasStarted && !isTransitioning
      : textValue.trim().length > 0 && !isTransitioning;

  const STEP_LABELS = ["who", "what"];

  const swipe = useSwipeNavigation({
    onSwipeLeft: canSubmit ? handleNext : undefined,
    onSwipeRight: onBack ? handleBack : undefined,
    enabled: !isTransitioning,
  });

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "hsl(225 25% 4%)" }}
      onTouchStart={swipe.onTouchStart}
      onTouchEnd={swipe.onTouchEnd}
    >
      {/* Top bar */}
      <motion.div
        className="flex flex-col gap-3 px-6 pt-12 pb-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        {/* Step blocks */}
        <div className="flex items-center gap-2">
          {/* Back button */}
          {onBack && (
            <motion.button
              type="button"
              onClick={handleBack}
              className="flex items-center justify-center w-11 h-11 -ml-2 rounded-full hover:bg-muted/50 transition-colors"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 55%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </motion.button>
          )}
          {STEP_LABELS.map((label, i) => {
            const isDone = i < questionIndex;
            const isActive = i === questionIndex;
            return (
              <motion.div
                key={i}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                animate={{
                  opacity: isDone || isActive ? 1 : 0.35,
                }}
                transition={{ duration: 0.3 }}
                style={{
                  background: isDone
                    ? "hsl(var(--primary) / 0.18)"
                    : isActive
                    ? "hsl(var(--primary) / 0.12)"
                    : "hsl(225 15% 10%)",
                  border: `1px solid ${
                    isDone
                      ? "hsl(var(--primary) / 0.5)"
                      : isActive
                      ? "hsl(var(--primary) / 0.35)"
                      : "hsl(225 15% 18%)"
                  }`,
                  color: isDone
                    ? "hsl(var(--primary))"
                    : isActive
                    ? "hsl(var(--primary))"
                    : "hsl(225 10% 45%)",
                }}
              >
                {isDone ? (
                  <motion.svg
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    width="11" height="11" viewBox="0 0 11 11" fill="none"
                  >
                    <path d="M2 5.5L4.5 8L9 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </motion.svg>
                ) : (
                  <span style={{ color: isActive ? "hsl(var(--primary) / 0.7)" : "hsl(225 10% 35%)", fontSize: "0.6rem" }}>
                    {i + 1}
                  </span>
                )}
                {label}
              </motion.div>
            );
          })}

          {/* Recording timer — pushed right */}
          <div className="flex-1" />
          {mode === "voice" && isRecording && (
            <motion.div
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 shadow-md"
              style={{ background: "hsla(225, 20%, 8%, 0.85)" }}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
              <span className="text-sm text-primary font-mono font-medium tabular-nums">
                {formatDuration(elapsed)}
              </span>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Question — centre stage */}
      <motion.div
        className="flex-1 flex flex-col items-start justify-center px-6 gap-4"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.h2
          variants={questionItem}
          className="font-display leading-tight tracking-tight"
          style={{
            fontSize: "clamp(2.1rem, 9vw, 2.8rem)",
            fontWeight: 800,
            color: "hsl(40 20% 95%)",
          }}
        >
          {question.text}
        </motion.h2>

        {question.subtext && (
          <motion.p
            variants={item}
            className="text-base leading-relaxed"
            style={{ color: "hsl(225 10% 55%)", fontWeight: 300 }}
          >
            {question.subtext}
          </motion.p>
        )}
      </motion.div>

      {/* Wave / Textarea + CTA */}
      <motion.div
        className="flex flex-col items-center gap-5 px-6 pb-safe"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {micDeniedNotice && mode === "text" && (
          <motion.div
            variants={item}
            className="w-full text-center text-xs rounded-2xl px-4 py-2"
            style={{ color: "hsl(225 10% 55%)", background: "hsl(225 15% 10%)" }}
          >
            Mic unavailable — type your answer instead
          </motion.div>
        )}

        {/* Waveform or Textarea */}
        <AnimatePresence mode="wait">
          {mode === "voice" ? (
            <motion.div
              key="waveform"
              variants={item}
              className="w-full h-16"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              <VoiceWave analyser={analyser} isRecording={isRecording} />
            </motion.div>
          ) : (
            <motion.div
              key="textarea"
              className="w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              <textarea
                ref={textareaRef}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder="Type your answer..."
                rows={4}
                className="w-full resize-none rounded-2xl px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-1"
                style={{
                  background: "hsl(225 15% 10%)",
                  color: "hsl(40 20% 95%)",
                  border: "1px solid hsl(225 15% 18%)",
                  focusRingColor: "hsl(var(--primary) / 0.4)",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status text (voice mode only) */}
        {mode === "voice" && (
          <motion.p
            variants={item}
            className="text-xs"
            style={{ color: "hsl(225 10% 45%)" }}
          >
            {!hasStarted
              ? "Starting microphone..."
              : isRecording
              ? "Recording — speak naturally"
              : "Preparing..."}
          </motion.p>
        )}

        {/* Escape hatch toggle — pill-sized tap target */}
        <motion.button
          type="button"
          onClick={mode === "voice" ? switchToText : switchToVoice}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.35, delay: 0.4 } }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm cursor-pointer transition-colors"
          style={{
            background: "hsl(225 15% 10%)",
            color: "hsl(225 10% 50%)",
            border: "1px solid hsl(225 15% 18%)",
          }}
          whileHover={{ borderColor: "hsl(225 15% 25%)", color: "hsl(225 10% 65%)" }}
          whileTap={{ scale: 0.96 }}
        >
          {mode === "voice" ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"><path d="M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm4 2v.01m4-.01v.01m4-.01v.01m4-.01v.01M6 14v.01M18 14v.01M10 14l4 .01"/></svg>
              Type instead?
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              Switch to voice
            </>
          )}
        </motion.button>

        {/* CTA */}
        <motion.button
          variants={item}
          onClick={handleNext}
          disabled={!canSubmit}
          className="w-full py-5 rounded-2xl font-display text-lg tracking-wide glow-primary disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            fontWeight: 700,
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
          whileTap={
            canSubmit
              ? { scale: 0.96, transition: { duration: 0.07 } }
              : {}
          }
          whileHover={
            canSubmit
              ? { filter: "brightness(1.12)", transition: { duration: 0.12 } }
              : {}
          }
        >
          {isLast ? "Finish" : "Next"}
        </motion.button>
      </motion.div>
    </div>
  );
}

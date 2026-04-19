import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import VoiceWave from "./VoiceWave";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { SurveyQuestion, VoiceAnswer } from "@/types/survey";

interface QuestionScreenProps {
  question: SurveyQuestion;
  questionIndex: number;
  totalQuestions: number;
  isLast: boolean;
  onNext: (answer: VoiceAnswer) => void;
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Stagger container
const stagger = {
  animate: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

// Individual element fade-up
const item = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

// Question text gets a slightly larger travel for emphasis
const questionItem = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function QuestionScreen({
  question,
  questionIndex,
  totalQuestions,
  isLast,
  onNext,
}: QuestionScreenProps) {
  const { isRecording, analyser, permissionDenied, start, stop } = useVoiceRecorder();
  const [elapsed, setElapsed] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
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

  const handleNext = async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    if (timerRef.current) clearInterval(timerRef.current);
    const result = await stop();
    onNext({
      questionId: question.id,
      blob: result.blob,
      url: result.url,
      durationMs: result.durationMs,
    });
  };

  const progress = ((questionIndex + 1) / totalQuestions) * 100;

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar — persistent layout element, no animation needed */}
      <div className="w-full h-0.5 bg-muted">
        <motion.div
          className="h-full bg-primary origin-left"
          initial={{ scaleX: (questionIndex / totalQuestions) }}
          animate={{ scaleX: progress / 100 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: "left" }}
        />
      </div>

      {/* Header */}
      <motion.div
        className="flex items-center justify-between px-5 pt-4 pb-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <span className="font-display text-xs text-muted-foreground tracking-widest uppercase">
          {questionIndex + 1} / {totalQuestions}
        </span>
        {isRecording && (
          <motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
            <span className="text-xs text-primary font-medium tabular-nums">
              {formatDuration(elapsed)}
            </span>
          </motion.div>
        )}
      </motion.div>

      {/* Question — centre stage, staggered */}
      <motion.div
        className="flex-1 flex flex-col items-center justify-center px-6 gap-4"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {question.hint && (
          <motion.p variants={item} className="text-muted-foreground text-sm text-center">
            {question.hint}
          </motion.p>
        )}
        <motion.h2
          variants={questionItem}
          className="font-display text-3xl leading-snug text-center text-foreground"
          style={{ fontWeight: 800 }}
        >
          {question.text}
        </motion.h2>
      </motion.div>

      {/* Wave + CTA — bottom section staggered */}
      <motion.div
        className="flex flex-col items-center gap-5 px-6 pb-10"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {permissionDenied && (
          <motion.div variants={item} className="w-full text-center text-sm text-destructive bg-destructive/10 rounded-xl p-3">
            Microphone access denied. Please allow mic access and reload.
          </motion.div>
        )}

        {/* Waveform */}
        <motion.div variants={item} className="w-full h-16">
          <VoiceWave analyser={analyser} isRecording={isRecording} />
        </motion.div>

        {/* Status */}
        <motion.p variants={item} className="text-xs text-muted-foreground">
          {!hasStarted
            ? "Starting microphone…"
            : isRecording
            ? "Recording — speak naturally"
            : "Preparing…"}
        </motion.p>

        {/* Next / Submit — instant tap feedback */}
        <motion.button
          variants={item}
          onClick={handleNext}
          disabled={!hasStarted || isTransitioning}
          className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-display text-lg tracking-wide glow-primary disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontWeight: 700 }}
          whileTap={
            hasStarted && !isTransitioning
              ? { scale: 0.96, transition: { duration: 0.07 } }
              : {}
          }
          whileHover={
            hasStarted && !isTransitioning
              ? { filter: "brightness(1.12)", transition: { duration: 0.12 } }
              : {}
          }
        >
          {isLast ? "Submit ✓" : "Next →"}
        </motion.button>
      </motion.div>
    </div>
  );
}

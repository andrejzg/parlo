import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import VoiceWave from "./VoiceWave";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
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
  onNext: (answer: VoiceAnswer) => void;
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
    id: "cq1",
    text: "Who will I be talking to?",
    subtext: "Describe your audience — customers, teammates, leads…",
  },
  {
    id: "cq2",
    text: "When do I need to get back to you by?",
    subtext: "Give me a deadline or timeframe.",
  },
  {
    id: "cq3",
    text: "What info do you need me to gather?",
    subtext: "Tell me the key things you want to learn.",
  },
];

export default function CreationQuestionScreen({
  question,
  questionIndex,
  totalQuestions,
  isLast,
  onNext,
}: CreationQuestionScreenProps) {
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

  const STEP_LABELS = ["who", "when", "what"];

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Top bar */}
      <motion.div
        className="flex flex-col gap-3 px-5 pt-12 pb-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        {/* Step blocks */}
        <div className="flex items-center gap-2">
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
          {isRecording && (
            <motion.div
              className="flex items-center gap-1.5"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-primary rec-blink" />
              <span className="text-xs text-primary font-medium tabular-nums">
                {formatDuration(elapsed)}
              </span>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Question — centre stage */}
      <motion.div
        className="flex-1 flex flex-col items-start justify-center px-7 gap-4"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.h2
          variants={questionItem}
          className="font-display leading-[1.1] tracking-tight"
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

      {/* Wave + CTA */}
      <motion.div
        className="flex flex-col items-center gap-5 px-6 pb-12"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {permissionDenied && (
          <motion.div
            variants={item}
            className="w-full text-center text-sm rounded-xl p-3"
            style={{
              color: "hsl(var(--destructive))",
              background: "hsl(var(--destructive) / 0.1)",
            }}
          >
            Microphone access denied. Please allow mic access and reload.
          </motion.div>
        )}

        {/* Waveform */}
        <motion.div variants={item} className="w-full h-16">
          <VoiceWave analyser={analyser} isRecording={isRecording} />
        </motion.div>

        {/* Status */}
        <motion.p
          variants={item}
          className="text-xs"
          style={{ color: "hsl(225 10% 45%)" }}
        >
          {!hasStarted
            ? "Starting microphone…"
            : isRecording
            ? "Recording — speak naturally"
            : "Preparing…"}
        </motion.p>

        {/* CTA */}
        <motion.button
          variants={item}
          onClick={handleNext}
          disabled={!hasStarted || isTransitioning}
          className="w-full py-5 rounded-2xl font-display text-lg tracking-wide glow-primary disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            fontWeight: 700,
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
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
          {isLast ? "Finish →" : "Next →"}
        </motion.button>
      </motion.div>
    </div>
  );
}

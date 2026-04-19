import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import CreateLanding from "@/components/CreateLanding";
import CreationQuestionScreen, { CREATION_QUESTIONS } from "@/components/CreationQuestionScreen";
import AgentReadyScreen from "@/components/AgentReadyScreen";
import AgentDashboard from "@/components/AgentDashboard";
import { VoiceAnswer } from "@/types/survey";

type Stage = "welcome" | "creating" | "ready" | "dashboard";

const pageVariants = {
  initial: {
    opacity: 0,
    y: 36,
    scale: 0.98,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.38,
      ease: [0.22, 1, 0.36, 1] as number[],
    },
  },
  exit: {
    opacity: 0,
    y: -24,
    scale: 1.01,
    transition: {
      duration: 0.22,
      ease: [0.55, 0, 1, 0.45] as number[],
    },
  },
};

export default function Index() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<VoiceAnswer[]>([]);
  const [screenKey, setScreenKey] = useState(0);

  const handleStart = () => {
    setStage("creating");
    setScreenKey((k) => k + 1);
  };

  const handleAnswer = (answer: VoiceAnswer) => {
    const updated = [...answers, answer];
    setAnswers(updated);
    const nextIndex = questionIndex + 1;
    if (nextIndex >= CREATION_QUESTIONS.length) {
      setStage("ready");
    } else {
      setQuestionIndex(nextIndex);
      setScreenKey((k) => k + 1);
    }
  };

  const handleDashboard = () => {
    setStage("dashboard");
    setScreenKey((k) => k + 1);
  };

  const pageKey =
    stage === "welcome"
      ? "welcome"
      : stage === "ready"
      ? "ready"
      : stage === "dashboard"
      ? "dashboard"
      : `cq-${screenKey}`;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="relative w-full max-w-sm h-screen overflow-hidden bg-background">
        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            key={pageKey}
            className="absolute inset-0"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {stage === "welcome" && (
              <CreateLanding onCreateAgent={handleStart} />
            )}
            {stage === "creating" && (
              <CreationQuestionScreen
                question={CREATION_QUESTIONS[questionIndex]}
                questionIndex={questionIndex}
                totalQuestions={CREATION_QUESTIONS.length}
                isLast={questionIndex === CREATION_QUESTIONS.length - 1}
                onNext={handleAnswer}
              />
            )}
            {stage === "ready" && (
              <AgentReadyScreen answers={answers} onDashboard={handleDashboard} />
            )}
            {stage === "dashboard" && (
              <AgentDashboard />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

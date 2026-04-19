import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import WelcomeScreen from "@/components/WelcomeScreen";
import QuestionScreen from "@/components/QuestionScreen";
import ThankYouScreen from "@/components/ThankYouScreen";
import { Survey, VoiceAnswer } from "@/types/survey";

const DEMO_SURVEY: Survey = {
  id: "demo-001",
  title: "How was your experience?",
  description: "Tell us in your own words. No typing — just speak. Takes 2–3 minutes.",
  ctaLabel: "Start recording →",
  questions: [
    {
      id: "q1",
      text: "What brought you to us today, and what were you hoping to find?",
      hint: "Question 1 of 3",
    },
    {
      id: "q2",
      text: "Walk us through your experience — what worked, what didn't?",
      hint: "Question 2 of 3",
    },
    {
      id: "q3",
      text: "If you could change one thing about what you experienced, what would it be?",
      hint: "Question 3 of 3",
    },
  ],
};

type Stage = "welcome" | "question" | "done";

// TypeForm-grade transition variants
// Exit: fast ease-in upward fade (content leaves decisively)
// Enter: fast-start, soft-settle from below (cubic-bezier(0.22, 1, 0.36, 1))
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

  const survey = DEMO_SURVEY;

  const handleStart = () => {
    setStage("question");
    setScreenKey((k) => k + 1);
  };

  const handleAnswer = (answer: VoiceAnswer) => {
    const updated = [...answers, answer];
    setAnswers(updated);
    const nextIndex = questionIndex + 1;
    if (nextIndex >= survey.questions.length) {
      setStage("done");
    } else {
      setQuestionIndex(nextIndex);
      setScreenKey((k) => k + 1);
    }
  };

  const pageKey = stage === "welcome" ? "welcome" : stage === "done" ? "done" : `q-${screenKey}`;

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ background: "var(--gradient-hero)" }}
    >
      {/* Phone shell — layout never changes, only content transitions */}
      <div className="relative w-full max-w-md h-screen max-h-[812px] overflow-hidden bg-background">
        {/* AnimatePresence mode="sync" = exit + enter overlap simultaneously */}
        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            key={pageKey}
            className="absolute inset-0"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {stage === "welcome" && <WelcomeScreen survey={survey} onStart={handleStart} />}
            {stage === "question" && (
              <QuestionScreen
                question={survey.questions[questionIndex]}
                questionIndex={questionIndex}
                totalQuestions={survey.questions.length}
                isLast={questionIndex === survey.questions.length - 1}
                onNext={handleAnswer}
              />
            )}
            {stage === "done" && <ThankYouScreen answers={answers} questions={survey.questions} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

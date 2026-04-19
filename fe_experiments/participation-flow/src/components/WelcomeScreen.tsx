import { motion } from "framer-motion";
import { Survey } from "@/types/survey";

interface WelcomeScreenProps {
  survey: Survey;
  onStart: () => void;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function WelcomeScreen({ survey, onStart }: WelcomeScreenProps) {
  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-6 py-12 text-center"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Brand mark */}
      <motion.div variants={fadeUp} className="flex items-center gap-2 opacity-50">
        <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
        <span className="text-xs font-display tracking-widest uppercase text-muted-foreground">
          Voice Survey
        </span>
      </motion.div>

      {/* Main content */}
      <div className="flex flex-col items-center gap-6 max-w-sm mx-auto">
        <motion.h1
          variants={fadeUp}
          className="font-display text-4xl leading-tight tracking-tight text-foreground"
          style={{ fontWeight: 800 }}
        >
          {survey.title}
        </motion.h1>

        <motion.p variants={fadeUp} className="text-secondary-foreground/70 text-lg leading-relaxed font-light">
          {survey.description}
        </motion.p>

        <motion.div variants={fadeUp} className="flex items-center gap-3 mt-2 text-muted-foreground text-sm">
          <span className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
            Voice only
          </span>
          <span className="opacity-30">·</span>
          <span>{survey.questions.length} question{survey.questions.length !== 1 ? "s" : ""}</span>
          <span className="opacity-30">·</span>
          <span>~{survey.questions.length}–{survey.questions.length * 2} min</span>
        </motion.div>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="w-full max-w-xs flex flex-col items-center gap-4">
        <motion.button
          onClick={onStart}
          className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-display text-lg tracking-wide glow-primary"
          style={{ fontWeight: 700 }}
          // Instant tap feedback — the "I caused this" feeling
          whileTap={{ scale: 0.96, transition: { duration: 0.08 } }}
          whileHover={{ filter: "brightness(1.12)", transition: { duration: 0.15 } }}
        >
          {survey.ctaLabel}
        </motion.button>
        <p className="text-muted-foreground text-xs">
          Your mic will be used to record answers
        </p>
      </motion.div>
    </motion.div>
  );
}

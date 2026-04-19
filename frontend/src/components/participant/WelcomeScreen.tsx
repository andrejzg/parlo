import { motion } from "framer-motion";
import { Survey } from "@/types/survey";
import { stagger, fadeUp } from "@/lib/animations";
import { getMediaMix } from "@/lib/mediaMix";

interface WelcomeScreenProps {
  survey: Survey;
  onStart: () => void;
}

export default function WelcomeScreen({ survey, onStart }: WelcomeScreenProps) {
  const mix = getMediaMix(survey.questions);
  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-6 pt-6 pb-safe sm:py-12 text-center"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Brand mark */}
      <motion.div variants={fadeUp} className="flex items-center gap-2 opacity-50">
        <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
        <span className="text-xs font-display tracking-widest uppercase text-muted-foreground">
          Parlo
        </span>
      </motion.div>

      {/* Main content */}
      <div className="flex flex-col items-center gap-6 max-w-sm mx-auto">
        <motion.h1
          variants={fadeUp}
          className="font-display text-2xl sm:text-4xl leading-tight tracking-tight text-foreground"
          style={{ fontWeight: 800 }}
        >
          {survey.title}
        </motion.h1>

        <motion.p variants={fadeUp} className="text-secondary-foreground/70 text-lg leading-relaxed font-light">
          {survey.description}
        </motion.p>

        <motion.div variants={fadeUp} className="flex items-center gap-3 mt-2 text-muted-foreground text-sm">
          <span className="flex items-center gap-1.5">
            {mix.isVoiceOnly || mix.hasVoice ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            ) : mix.hasVideo ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
            {mix.label}
          </span>
          <span className="opacity-30">&middot;</span>
          <span>{survey.questions.length} question{survey.questions.length !== 1 ? "s" : ""}</span>
          <span className="opacity-30">&middot;</span>
          <span>{mix.timeEstimate}</span>
        </motion.div>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="w-full max-w-xs flex flex-col items-center gap-4">
        <motion.button
          onClick={onStart}
          className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-display text-lg tracking-wide glow-primary"
          style={{ fontWeight: 700 }}
          whileTap={{ scale: 0.96, transition: { duration: 0.08 } }}
          whileHover={{ filter: "brightness(1.12)", transition: { duration: 0.15 } }}
        >
          {survey.ctaLabel}
        </motion.button>
        <p className="text-muted-foreground text-xs">
          {mix.securityFootnote}
        </p>
      </motion.div>
    </motion.div>
  );
}

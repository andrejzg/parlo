import { useEffect } from "react";
import { motion } from "framer-motion";
import { trackEvent } from "@/lib/posthog";

interface ConsentScreenProps {
  description: string;
  buttonLabel: string;
  onConsent: () => void;
  isLoading?: boolean;
  onBack?: () => void;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function ConsentScreen({ description, buttonLabel, onConsent, isLoading, onBack }: ConsentScreenProps) {
  useEffect(() => {
    trackEvent("consent_screen_viewed");
  }, []);

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-6 pt-6 pb-safe sm:py-12 text-center"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Top row: back button + brand mark */}
      <motion.div variants={fadeUp} className="w-full flex items-center justify-between">
        {onBack ? (
          <motion.button
            type="button"
            onClick={onBack}
            className="flex items-center justify-center w-10 h-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            whileTap={{ scale: 0.9 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </motion.button>
        ) : (
          <div className="w-10" />
        )}
        <div className="flex items-center gap-2 opacity-50">
          <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
          <span className="text-xs font-display tracking-widest uppercase text-muted-foreground">
            Parlo
          </span>
        </div>
        <div className="w-10" />
      </motion.div>

      {/* Main content */}
      <div className="flex flex-col items-center gap-6 max-w-sm mx-auto">
        <motion.h1
          variants={fadeUp}
          className="font-display text-xl sm:text-3xl leading-tight tracking-tight text-foreground"
          style={{ fontWeight: 800 }}
        >
          Before you start
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="text-secondary-foreground/70 text-base leading-relaxed font-light"
        >
          {description}
        </motion.p>

        <motion.p
          variants={fadeUp}
          className="text-muted-foreground text-sm leading-relaxed"
        >
          By continuing, you agree to our{" "}
          <a href="https://parlo.me/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Terms of Service</a> and{" "}
          <a href="https://parlo.me/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Privacy Policy</a>.
        </motion.p>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="w-full max-w-xs flex flex-col items-center gap-4">
        <motion.button
          onClick={onConsent}
          disabled={isLoading}
          className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-display text-lg tracking-wide glow-primary disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ fontWeight: 700 }}
          whileTap={!isLoading ? { scale: 0.96, transition: { duration: 0.08 } } : {}}
          whileHover={!isLoading ? { filter: "brightness(1.1)", transition: { duration: 0.15 } } : {}}
        >
          {isLoading ? "Setting up..." : buttonLabel}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

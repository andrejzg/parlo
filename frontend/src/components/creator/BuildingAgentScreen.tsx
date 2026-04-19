import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";

interface BuildingAgentScreenProps {
  /** If provided, called on mount. The screen waits for both the promise AND
   *  a minimum display time (3 s) before calling onDone with the result. */
  onGenerate?: () => Promise<unknown>;
  onDone: (result?: unknown) => void;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

const STEPS = [
  "Analyzing your voice instructions...",
  "Understanding your audience...",
  "Generating interview questions...",
  "Building your agent...",
];

const MIN_DISPLAY_MS = 3000;

export default function BuildingAgentScreen({ onGenerate, onDone }: BuildingAgentScreenProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const calledRef = useRef(false);

  useEffect(() => {
    // Step animation — cycles through the cosmetic steps
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= STEPS.length - 1) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 1200);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    if (!onGenerate) {
      // Legacy/fallback: no API call, just wait for the animation to finish
      const timeout = setTimeout(() => onDone(), MIN_DISPLAY_MS + 800);
      return () => clearTimeout(timeout);
    }

    const startTime = Date.now();

    onGenerate()
      .then((result) => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
        setTimeout(() => onDone(result), remaining);
      })
      .catch((err) => {
        // On error, still respect minimum display time so it doesn't flash
        console.error("BuildingAgentScreen: onGenerate failed", err);
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
        setTimeout(() => onDone({ error: err }), remaining);
      });
  }, [onGenerate, onDone]);

  return (
    <div
      className="flex flex-col h-full items-center justify-center px-6"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      <motion.div
        className="flex flex-col items-center gap-8 w-full max-w-sm"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* Animated pulse icon */}
        <motion.div variants={fadeUp} className="relative flex items-center justify-center">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--primary) / 0.12)" }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "hsl(var(--primary) / 0.22)" }}
            >
              <motion.svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              >
                <path
                  d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"
                  stroke="hsl(22, 95%, 62%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"
                  stroke="hsl(22, 95%, 62%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </motion.svg>
            </div>
          </div>
          <div
            className="absolute inset-0 w-24 h-24 rounded-full border-2 pulse-ring"
            style={{ borderColor: "hsl(var(--primary) / 0.3)" }}
          />
        </motion.div>

        {/* Headline */}
        <motion.div variants={fadeUp} className="text-center space-y-3">
          <h1
            className="font-display leading-tight"
            style={{
              fontSize: "clamp(2rem, 8vw, 2.6rem)",
              fontWeight: 800,
              color: "hsl(40 20% 95%)",
            }}
          >
            Building your agent...
          </h1>
        </motion.div>

        {/* Step progress */}
        <motion.div variants={fadeUp} className="w-full space-y-3">
          {STEPS.map((step, i) => (
            <motion.div
              key={i}
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              initial={{ opacity: 0, x: -12 }}
              animate={{
                opacity: i <= currentStep ? 1 : 0.3,
                x: 0,
              }}
              transition={{ delay: i * 0.15, duration: 0.35 }}
              style={{
                background: i <= currentStep ? "hsl(225 15% 10%)" : "transparent",
              }}
            >
              {i < currentStep ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="8" fill="hsl(22, 95%, 62%)" fillOpacity="0.2" />
                    <path d="M4.5 8L7 10.5L11.5 5.5" stroke="hsl(22, 95%, 62%)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.div>
              ) : i === currentStep ? (
                <div className="w-4 h-4 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
                </div>
              ) : (
                <div className="w-4 h-4 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: "hsl(225 10% 30%)" }} />
                </div>
              )}
              <span
                className="text-sm"
                style={{
                  color: i <= currentStep ? "hsl(40 20% 85%)" : "hsl(225 10% 35%)",
                }}
              >
                {step}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}

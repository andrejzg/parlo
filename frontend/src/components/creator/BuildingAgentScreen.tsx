import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { Check, Mic } from "lucide-react";
import { stagger, fadeUp, transitionLarge } from "@/lib/animations";

interface BuildingAgentScreenProps {
  /** If provided, called on mount. The screen waits for both the promise AND
   *  a minimum display time (3 s) before calling onDone with the result. */
  onGenerate?: () => Promise<unknown>;
  onDone: (result?: unknown) => void;
}

const STEPS = [
  "Reading your brief...",
  "Folding in your answers...",
  "Writing the interview...",
  "Building your agent...",
];

const MIN_DISPLAY_MS = 3000;

/** A completed step's tick popping in: theme small-motion duration with a light bounce. */
const tickPop = { type: "spring" as const, visualDuration: 0.2, bounce: 0.2 };

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
    <div className="flex flex-col h-full items-center justify-center px-l bg-background">
      <motion.div
        className="flex flex-col items-center gap-xl w-full max-w-sm"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* Processing indicator: slow-turning mic inside a pulsing ring (status loops keep their own cadence) */}
        <motion.div variants={fadeUp} className="relative flex items-center justify-center">
          <div className="w-24 h-24 rounded-full flex items-center justify-center bg-color-1-transparent text-color-1">
            <motion.span
              className="flex"
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            >
              <Mic size={30} aria-hidden />
            </motion.span>
          </div>
          <div
            className="absolute inset-0 w-24 h-24 rounded-full shadow-[inset_0_0_0_2px_var(--color-1-transparent)] pulse-ring"
            aria-hidden
          />
        </motion.div>

        {/* Headline */}
        <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground text-center">
          Building your agent...
        </motion.h1>

        {/* Step progress */}
        <motion.div variants={fadeUp} className="w-full flex flex-col gap-s">
          {STEPS.map((step, i) => (
            <motion.div
              key={i}
              className={`flex items-center gap-s px-m py-s rounded-s transition-colors ${
                i <= currentStep ? "bg-card" : "bg-transparent"
              }`}
              initial={{ opacity: 0, x: -12 }}
              animate={{
                opacity: i <= currentStep ? 1 : 0.3,
                x: 0,
              }}
              transition={{ ...transitionLarge, delay: i * 0.15 }}
            >
              {i < currentStep ? (
                <motion.span
                  className="flex items-center justify-center w-4 h-4 rounded-full bg-color-1-transparent text-color-1"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={tickPop}
                >
                  <Check size={10} aria-hidden />
                </motion.span>
              ) : i === currentStep ? (
                <span className="w-4 h-4 flex items-center justify-center">
                  <span className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
                </span>
              ) : (
                <span className="w-4 h-4 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-5" />
                </span>
              )}
              <span className={`text-s ${i === currentStep ? "text-foreground" : "text-muted-foreground"}`}>
                {step}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}

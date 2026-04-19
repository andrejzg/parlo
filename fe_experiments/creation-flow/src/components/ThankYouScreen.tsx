import { motion } from "framer-motion";
import { VoiceAnswer } from "@/types/survey";

interface ThankYouScreenProps {
  answers: VoiceAnswer[];
  questions: { id: string; text: string }[];
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function ThankYouScreen({ answers, questions }: ThankYouScreenProps) {
  const totalMs = answers.reduce((acc, a) => acc + a.durationMs, 0);

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-6 py-12 text-center"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Brand mark */}
      <motion.div variants={fadeUp} className="flex items-center gap-2 opacity-50">
        <div className="w-2 h-2 rounded-full bg-primary" />
        <span className="text-xs font-display tracking-widest uppercase text-muted-foreground">
          Voice Survey
        </span>
      </motion.div>

      {/* Main content */}
      <div className="flex flex-col items-center gap-6 max-w-sm mx-auto">
        {/* Check mark */}
        <motion.div
          variants={fadeUp}
          className="relative flex items-center justify-center"
        >
          <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-primary/25 flex items-center justify-center">
              <motion.svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="hsl(22, 95%, 62%)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <motion.polyline points="20 6 9 17 4 12" />
              </motion.svg>
            </div>
          </div>
          <div className="absolute inset-0 w-20 h-20 rounded-full border-2 border-primary/30 pulse-ring" />
        </motion.div>

        <motion.div variants={fadeUp} className="space-y-3">
          <h1 className="font-display text-4xl leading-tight text-foreground" style={{ fontWeight: 800 }}>
            All done!
          </h1>
          <p className="text-secondary-foreground/70 text-lg leading-relaxed font-light">
            Your voice responses have been recorded. Thank you for sharing your thoughts.
          </p>
        </motion.div>

        {/* Summary card */}
        <motion.div
          variants={fadeUp}
          className="w-full bg-card rounded-2xl border border-border p-5 text-left space-y-3"
        >
          <p className="font-display text-xs text-muted-foreground tracking-widest uppercase mb-4">
            Summary
          </p>
          {answers.map((answer) => {
            const q = questions.find((q) => q.id === answer.questionId);
            return (
              <div key={answer.questionId} className="flex items-start justify-between gap-3">
                <p className="text-sm text-foreground/80 flex-1 line-clamp-1">{q?.text}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span className="text-xs text-muted-foreground font-medium tabular-nums">
                    {formatDuration(answer.durationMs)}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="border-t border-border pt-3 mt-3 flex justify-between">
            <span className="text-xs text-muted-foreground">Total recording time</span>
            <span className="text-xs font-medium text-foreground tabular-nums">{formatDuration(totalMs)}</span>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <motion.p variants={fadeUp} className="text-muted-foreground text-xs">
        Powered by{" "}
        <span className="text-foreground/50 font-display">VoiceSurvey</span>
      </motion.p>
    </motion.div>
  );
}

import { motion } from "framer-motion";

/**
 * Shown after the 2nd follow-up answer, then after the 5th, 10th, 15th…
 * (see isClarifyCheckpoint). Lets the creator build the agent now or keep
 * sharpening it with more Cerebras-generated questions.
 */
interface CheckpointScreenProps {
  answeredCount: number;
  onCreate: () => void;
  onContinue: () => void;
  /** False once we hit the clarification cap — only "Create agent" remains. */
  canContinue?: boolean;
  /** Parent is fetching the next question. */
  busy?: boolean;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function CheckpointScreen({
  answeredCount,
  onCreate,
  onContinue,
  canContinue = true,
  busy = false,
}: CheckpointScreenProps) {
  const headline = !canContinue
    ? "That's plenty."
    : answeredCount <= 2
    ? "I've got the gist."
    : "It's getting sharp.";
  const body = !canContinue
    ? "We've covered a lot of ground. Let's build your agent."
    : answeredCount <= 2
    ? "Create your agent now, or answer a few more questions to sharpen it."
    : `${answeredCount} answers in. Create it now, or keep going for an even sharper interview.`;

  return (
    <div
      className="flex flex-col h-full px-6 pt-10 pb-safe"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      <span className="text-xs font-display tracking-widest uppercase" style={{ color: "hsl(225 10% 45%)" }}>
        Step 2 · Follow-ups
      </span>

      <motion.div
        className="flex-1 flex flex-col justify-center gap-5"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={fadeUp} className="flex items-center gap-2" aria-label={`${answeredCount} follow-ups answered`}>
          {Array.from({ length: Math.min(answeredCount, 10) }).map((_, i) => (
            <motion.span
              key={i}
              className="w-2 h-2 rounded-full"
              style={{ background: "hsl(150 60% 45%)" }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.15 + i * 0.05, type: "spring", stiffness: 400, damping: 20 }}
            />
          ))}
        </motion.div>
        <motion.h2
          variants={fadeUp}
          className="font-serif leading-[1.05] tracking-tight"
          style={{ fontSize: "clamp(2.2rem, 9.5vw, 3rem)", fontWeight: 600, color: "hsl(40 20% 95%)" }}
        >
          {headline}
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="text-base leading-relaxed"
          style={{ color: "hsl(225 10% 55%)", fontWeight: 300 }}
        >
          {body}
        </motion.p>
      </motion.div>

      <motion.div className="flex flex-col gap-3" variants={stagger} initial="initial" animate="animate">
        <motion.button
          variants={fadeUp}
          onClick={onCreate}
          disabled={busy}
          data-testid="checkpoint-create"
          className="w-full py-5 rounded-2xl font-display text-lg tracking-wide glow-primary disabled:opacity-40"
          style={{ fontWeight: 700, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          whileTap={{ scale: 0.96, transition: { duration: 0.07 } }}
        >
          Create agent
        </motion.button>
        {canContinue && (
          <motion.button
            variants={fadeUp}
            onClick={onContinue}
            disabled={busy}
            data-testid="checkpoint-continue"
            className="w-full py-4 rounded-2xl font-display text-base tracking-wide disabled:opacity-40"
            style={{
              fontWeight: 600,
              background: "hsl(225 15% 10%)",
              color: "hsl(40 15% 85%)",
              border: "1px solid hsl(225 15% 18%)",
            }}
            whileTap={{ scale: 0.97, transition: { duration: 0.07 } }}
          >
            {busy ? "Thinking…" : "Ask me more"}
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}

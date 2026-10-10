import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { stagger, fadeUp } from "@/lib/animations";

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

/** Each answered-count dot popping in: theme small-motion duration with a light bounce. */
const dotPop = { type: "spring" as const, visualDuration: 0.2, bounce: 0.2 };

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
    <div className="flex flex-col h-full px-l pt-xl pb-safe bg-background">
      <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground text-center">
        Step 2 · Follow-ups
      </span>

      <motion.div
        className="flex-1 flex flex-col justify-center gap-m"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={fadeUp} className="flex items-center gap-xs" aria-label={`${answeredCount} follow-ups answered`}>
          {Array.from({ length: Math.min(answeredCount, 10) }).map((_, i) => (
            <motion.span
              key={i}
              className="w-2 h-2 rounded-full bg-success"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...dotPop, delay: 0.15 + i * 0.05 }}
            />
          ))}
        </motion.div>
        <motion.h2 variants={fadeUp} className="font-brand text-l font-heavy text-foreground">
          {headline}
        </motion.h2>
        <motion.p variants={fadeUp} className="text-m text-neutral-8">
          {body}
        </motion.p>
      </motion.div>

      <motion.div className="flex flex-col gap-s" variants={stagger} initial="initial" animate="animate">
        <motion.div variants={fadeUp}>
          <Button size="lg" className="w-full" onClick={onCreate} disabled={busy} data-testid="checkpoint-create">
            Create agent
          </Button>
        </motion.div>
        {canContinue && (
          <motion.div variants={fadeUp}>
            <Button
              size="lg"
              variant="secondary"
              className="w-full"
              onClick={onContinue}
              disabled={busy}
              data-testid="checkpoint-continue"
            >
              {busy ? "Thinking…" : "Ask me more"}
            </Button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

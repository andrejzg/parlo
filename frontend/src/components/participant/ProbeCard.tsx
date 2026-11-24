import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProbeCardProps {
  /** The agent's follow-up, in its words. */
  text: string;
  /** 1 for the first follow-up on this question, 2 for the second (the last). */
  n?: number;
  /**
   * The participant is recording their answer to it: the question stays on
   * screen so they can see what they are answering, the actions go.
   */
  recording?: boolean;
  onAnswer: () => void;
  /** Moves on to the next question without answering it. */
  onSkip: () => void;
}

/**
 * A study only: the agent heard the answer, found the question not quite
 * answered, and asks one short follow-up on the same screen. Answering it
 * records a further clip of the same answer; skipping it is always allowed
 * and moves on. While the card is up these two are the only actions: the
 * screen's own Next button steps aside.
 */
export default function ProbeCard({ text, n = 1, recording = false, onAnswer, onSkip }: ProbeCardProps) {
  return (
    <div className="w-full rounded-m bg-card p-m flex flex-col gap-s text-left" data-testid="probe-card" aria-live="polite">
      <div className="flex flex-col gap-xxs">
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
          {n > 1 ? "One last follow-up" : "One follow-up"}
        </span>
        <p className="text-m font-medium text-foreground" data-testid="probe-text">
          {text}
        </p>
      </div>

      {!recording && (
        <div className="flex flex-col gap-xs">
          <Button type="button" size="lg" className="w-full" onClick={onAnswer} data-testid="probe-answer">
            <Mic aria-hidden />
            Answer
          </Button>
          <Button type="button" variant="secondary" className="w-full" onClick={onSkip} data-testid="probe-skip">
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}

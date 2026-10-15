import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AUDIENCES,
  DEFAULT_AUDIENCE,
  DEFAULT_LENGTH,
  LENGTHS,
  sentenceParts,
  type AudienceId,
  type LengthId,
  type Shape,
} from "@/lib/shapes";
import { fadeUp, stagger, transitionLarge } from "@/lib/animations";

/**
 * The second screen of creation: the sentence the chosen shape started, with
 * one blank to fill ("Take the temperature of [my team] on ___"). The blank
 * is typed (the mic beside the CTA was removed on 2026-10-15: a few words is
 * a typing job, and the next screen is where the picks happen). The audience
 * chips swap the phrase in the sentence and set the tone; the length chips
 * set how many questions the agent writes. Every tap changes the screen at
 * once; nothing here calls a model. "Continue" goes to the outputs cards.
 */
export interface TopicResult {
  topic: string;
  audience: AudienceId;
  length: LengthId;
  /** Always "text" since the mic went; kept for the `create_blank_filled` event. */
  mode: "voice" | "text";
}

interface TopicScreenProps {
  shape: Shape;
  initialTopic?: string;
  initialAudience?: AudienceId;
  initialLength?: LengthId;
  /** Parent is moving on — lock the CTA. */
  busy?: boolean;
  onContinue: (result: TopicResult) => void;
  onBack: () => void;
}

function Chip({
  selected,
  onClick,
  children,
  testId,
  data,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
  data: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      data-value={data}
      data-selected={selected}
      className={`rounded-full px-m py-xs text-s font-medium transition-[background-color,color,transform] active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ${
        selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-neutral-4"
      }`}
    >
      {children}
    </button>
  );
}

export default function TopicScreen({
  surveyId,
  shape,
  initialTopic = "",
  initialAudience = DEFAULT_AUDIENCE,
  initialLength = DEFAULT_LENGTH,
  busy = false,
  onContinue,
  onBack,
}: TopicScreenProps) {
  const [topic, setTopic] = useState(initialTopic);
  const [audience, setAudience] = useState<AudienceId>(initialAudience);
  const [length, setLength] = useState<LengthId>(initialLength);
  const [leaving, setLeaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // The blank grows with its text and starts focused, so typing is one tap away.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [topic]);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleContinue = () => {
    if (leaving || busy) return;
    const text = topic.trim();
    if (!text) return;
    setLeaving(true);
    onContinue({ topic: text, audience, length, mode: "text" });
  };

  const handleBack = () => {
    if (leaving) return;
    setLeaving(true);
    onBack();
  };

  const [before, who, after] = sentenceParts(shape, audience);
  const canContinue = topic.trim().length > 0 && !leaving && !busy;

  return (
    // The column scrolls when the keyboard shrinks the viewport rather than clipping the CTA.
    <div className="flex flex-col h-full overflow-y-auto bg-background">
      <motion.div
        className="flex items-center px-l pt-xxl pb-xxs shrink-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        <Button type="button" variant="ghost" size="icon" onClick={handleBack} aria-label="Back" className="-ml-xs">
          <ChevronLeft className="!size-6" aria-hidden />
        </Button>
      </motion.div>

      <motion.div className="px-l pt-xxs shrink-0" variants={stagger} initial="initial" animate="animate">
        <motion.p variants={fadeUp} className="font-editorial text-l sm:text-xl font-medium text-foreground" data-testid="topic-sentence">
          {before}
          <span className="rounded-xs bg-muted px-xxs" data-testid="topic-who">
            {who}
          </span>
          {after}
        </motion.p>
        <motion.div variants={fadeUp}>
          <textarea
            ref={textareaRef}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleContinue();
              }
            }}
            placeholder={shape.example}
            rows={1}
            aria-label="What it's about"
            data-testid="topic-textarea"
            className="w-full mt-xs resize-none bg-transparent font-editorial text-l sm:text-xl font-medium text-foreground placeholder:text-neutral-6 caret-color-1 outline-none"
          />
        </motion.div>
      </motion.div>

      <motion.div className="px-l pt-l flex flex-col gap-l shrink-0" variants={stagger} initial="initial" animate="animate">
        <motion.div variants={fadeUp} className="flex flex-col gap-s">
          <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">Who are they?</span>
          <div className="flex flex-wrap gap-xs">
            {AUDIENCES.filter((a) => a.id !== DEFAULT_AUDIENCE).map((a) => (
              <Chip
                key={a.id}
                selected={audience === a.id}
                onClick={() => setAudience(audience === a.id ? DEFAULT_AUDIENCE : a.id)}
                testId="who-chip"
                data={a.id}
              >
                {a.label}
              </Chip>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="flex flex-col gap-s">
          <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">How long for them?</span>
          <div className="flex flex-wrap gap-xs">
            {LENGTHS.map((l) => (
              <Chip key={l.id} selected={length === l.id} onClick={() => setLength(l.id)} testId="length-chip" data={l.id}>
                {l.label}
              </Chip>
            ))}
          </div>
        </motion.div>
      </motion.div>

      <div className="flex-1 min-h-6" />

      <motion.div
        className="px-l pt-m pb-safe flex flex-col items-center gap-s shrink-0"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={fadeUp} className="w-full">
          <Button size="lg" className="w-full" onClick={handleContinue} disabled={!canContinue} data-testid="topic-continue">
            {busy ? "One moment…" : "Continue"}
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}

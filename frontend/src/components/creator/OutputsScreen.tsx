import { useState } from "react";
import { motion } from "framer-motion";
import { AlignLeft, Check, ChevronLeft, GalleryHorizontalEnd, ListOrdered, Mic, Smartphone, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleSheetIcon } from "@/components/creator/BrandIcons";
import { OUTPUTS, sortOutputs, type OutputId } from "@/lib/outputs";
import { fadeUp, stagger, transitionLarge } from "@/lib/animations";
import { useFitLines } from "@/hooks/useFitLines";

/**
 * The second card screen of creation: what should the agent make, beyond
 * the report it always writes? Six content types (not channels, see
 * GROWTH.md 2026-10-25), the same deck as the shape cards, but several can
 * be on at once: a tap flips a card to the primary fill, "Continue" is live
 * from the first frame (nothing picked is a valid answer). Google Sheet &
 * Drive starts on (`DEFAULT_OUTPUTS`); the page owns that default.
 */
interface OutputsScreenProps {
  initialOutputs?: OutputId[];
  onContinue: (outputs: OutputId[]) => void;
  onBack?: () => void;
}

const ICONS: Record<OutputId, LucideIcon | typeof GoogleSheetIcon> = {
  sheet: GoogleSheetIcon,
  clips: Smartphone,
  post: AlignLeft,
  thread: ListOrdered,
  carousel: GalleryHorizontalEnd,
  episode: Mic,
};

/** A card title that steps down the type scale until it fits two lines (a hook, so it needs its own component inside the map). */
const TITLE_STEPS = ["text-m", "text-s", "text-xs"] as const;

function CardTitle({ children, className }: { children: string; className: string }) {
  const fit = useFitLines<HTMLSpanElement>(2, TITLE_STEPS);
  return (
    <span ref={fit.ref} className={`${fit.className} font-medium ${className}`} data-testid="output-title" data-size={fit.className}>
      {children}
    </span>
  );
}

export default function OutputsScreen({ initialOutputs = [], onContinue, onBack }: OutputsScreenProps) {
  const [picked, setPicked] = useState<Set<OutputId>>(() => new Set(initialOutputs));

  const toggle = (id: OutputId) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <motion.div
        className="flex items-center px-l pt-xxl pb-xxs shrink-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        {onBack && (
          <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back" className="-ml-xs">
            <ChevronLeft className="!size-6" aria-hidden />
          </Button>
        )}
      </motion.div>

      <motion.div
        className="flex-1 min-h-0 overflow-y-auto px-l"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.h1 variants={fadeUp} className="font-editorial text-l sm:text-xl font-medium text-foreground pt-xxs pb-xs">
          What should it make?
        </motion.h1>
        <motion.p variants={fadeUp} className="text-s text-muted-foreground pb-l" data-testid="outputs-subline">
          From everyone's answers. The report always comes back.
        </motion.p>

        <div className="grid grid-cols-2 gap-s pb-l">
          {OUTPUTS.map((output) => {
            const Icon = ICONS[output.id];
            const selected = picked.has(output.id);
            return (
              <motion.button
                key={output.id}
                variants={fadeUp}
                type="button"
                onClick={() => toggle(output.id)}
                aria-pressed={selected}
                data-testid="output-card"
                data-output={output.id}
                data-selected={selected}
                className={`relative flex flex-col items-start gap-s rounded-m p-m text-left transition-[background-color,box-shadow,transform] active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ${
                  selected ? "bg-primary text-primary-foreground" : "bg-card hover:bg-neutral-3"
                }`}
              >
                <Icon size={22} aria-hidden className={selected ? "text-primary-foreground" : "text-neutral-8"} />
                {selected && (
                  <span
                    aria-hidden
                    className="absolute top-s right-s flex size-5 items-center justify-center rounded-full bg-background text-foreground"
                  >
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
                <span className="flex flex-col gap-xxs">
                  <CardTitle className={selected ? "text-primary-foreground" : "text-foreground"}>{output.label}</CardTitle>
                  <span className={`text-xs ${selected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{output.example}</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      <motion.div
        className="px-l pt-m pb-safe flex flex-col items-center gap-s shrink-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        <Button size="lg" className="w-full" onClick={() => onContinue(sortOutputs(picked))} data-testid="outputs-build">
          Continue
        </Button>
      </motion.div>
    </div>
  );
}

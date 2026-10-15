import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Ellipsis, Eye, Lightbulb, ListOrdered, MessageCircle, Scale, Thermometer, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SHAPES, type ShapeId } from "@/lib/shapes";
import { fadeUp, stagger, transitionLarge } from "@/lib/animations";

/**
 * The first screen of creation: what do you want back from the group?
 * Eight cards, each the shape of an answer (a decision, a ranking, the
 * mood…), never a use-case template. Tapping a card is the whole action;
 * "Something else" opens the free-form brief instead.
 */
interface ShapeScreenProps {
  onPick: (shape: ShapeId) => void;
  onBack?: () => void;
  /** The parlo is still being created — cards wait for it. */
  busy?: boolean;
}

const ICONS: Record<ShapeId, LucideIcon> = {
  decide: Scale,
  rank: ListOrdered,
  temperature: Thermometer,
  ideas: Lightbulb,
  stories: MessageCircle,
  feedback: Eye,
  headcount: Users,
  other: Ellipsis,
};

export default function ShapeScreen({ onPick, onBack, busy = false }: ShapeScreenProps) {
  const [picked, setPicked] = useState<ShapeId | null>(null);

  const pick = (id: ShapeId) => {
    if (busy || picked) return;
    setPicked(id);
    onPick(id);
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
        className="flex-1 min-h-0 overflow-y-auto px-l pb-safe"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.h1 variants={fadeUp} className="font-editorial text-l sm:text-xl font-medium text-foreground pt-xxs pb-l">
          What do you want back?
        </motion.h1>

        <div className="grid grid-cols-2 gap-s pb-l">
          {SHAPES.map((shape) => {
            const Icon = ICONS[shape.id];
            const selected = picked === shape.id;
            const isOther = shape.id === "other";
            return (
              <motion.button
                key={shape.id}
                variants={fadeUp}
                type="button"
                onClick={() => pick(shape.id)}
                disabled={busy}
                aria-pressed={selected}
                data-testid="shape-card"
                data-shape={shape.id}
                className={`flex flex-col items-start gap-s rounded-m p-m text-left transition-[background-color,box-shadow,transform] active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none ${
                  isOther ? "bg-transparent shadow-edge-transparent hover:bg-card" : "bg-card hover:bg-neutral-3"
                } ${selected ? "shadow-edge-accent" : ""}`}
              >
                <Icon size={22} aria-hidden className={selected ? "text-color-1" : "text-neutral-8"} />
                <span className="flex flex-col gap-xxs">
                  <span className="text-m font-medium text-foreground">{shape.label}</span>
                  <span className="text-xs text-muted-foreground">{shape.example}</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

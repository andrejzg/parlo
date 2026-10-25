import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  Ellipsis,
  Eye,
  FlaskConical,
  HeartHandshake,
  IdCard,
  Megaphone,
  PartyPopper,
  PenLine,
  UserSearch,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SHAPES, type Shape, type ShapeId } from "@/lib/shapes";
import { fadeUp, stagger, transitionLarge } from "@/lib/animations";

/**
 * The first screen of creation: what do you want to find out? Six cards for
 * founders and operators, self-promotion first (crowdsource a post,
 * testimonials, a milestone), then validate an idea, interview customers,
 * get feedback. A full-width "More" card swaps the deck for the rest: ask my
 * team, check references, and "Something else", which opens the free-form
 * brief. Tapping a card is the whole action.
 */
interface ShapeScreenProps {
  onPick: (shape: ShapeId) => void;
  onBack?: () => void;
  /** "More" was opened (for analytics). */
  onMore?: () => void;
  /** The parlo is still being created — cards wait for it. */
  busy?: boolean;
}

const ICONS: Record<ShapeId, LucideIcon> = {
  post: Megaphone,
  testimonials: HeartHandshake,
  milestone: PartyPopper,
  validate: FlaskConical,
  customers: UserSearch,
  feedback: Eye,
  team: Users,
  references: IdCard,
  other: PenLine,
};

const DECK = SHAPES.filter((s) => !s.more);
const MORE = SHAPES.filter((s) => s.more);

const cardClass =
  "rounded-m p-m text-left transition-[background-color,box-shadow,transform] active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none";

export default function ShapeScreen({ onPick, onBack, onMore, busy = false }: ShapeScreenProps) {
  const [picked, setPicked] = useState<ShapeId | null>(null);
  const [showMore, setShowMore] = useState(false);

  const pick = (id: ShapeId) => {
    if (busy || picked) return;
    setPicked(id);
    onPick(id);
  };

  const openMore = () => {
    if (busy || picked) return;
    setShowMore(true);
    onMore?.();
  };

  const card = (shape: Shape, row: boolean) => {
    const Icon = ICONS[shape.id];
    const selected = picked === shape.id;
    const outlined = shape.id === "other";
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
        className={`flex ${row ? "flex-row items-center gap-m" : "flex-col items-start gap-s"} ${cardClass} ${
          outlined ? "bg-transparent shadow-edge-transparent hover:bg-card" : "bg-card hover:bg-neutral-3"
        } ${selected ? "shadow-edge-accent" : ""}`}
      >
        <Icon size={22} aria-hidden className={`shrink-0 ${selected ? "text-color-1" : "text-neutral-8"}`} />
        <span className="flex flex-col gap-xxs">
          <span className="text-m font-medium text-foreground">{shape.label}</span>
          <span className="text-xs text-muted-foreground">{shape.card}</span>
        </span>
      </motion.button>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <motion.div
        className="flex items-center px-l pt-xxl pb-xxs shrink-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        {(showMore || onBack) && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={showMore ? () => setShowMore(false) : onBack}
            aria-label="Back"
            className="-ml-xs"
            data-testid="shape-back"
          >
            <ChevronLeft className="!size-6" aria-hidden />
          </Button>
        )}
      </motion.div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={showMore ? "more" : "deck"}
          className="flex-1 min-h-0 overflow-y-auto px-l pb-safe"
          variants={stagger}
          initial="initial"
          animate="animate"
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          <motion.h1 variants={fadeUp} className="font-editorial text-l sm:text-xl font-medium text-foreground pt-xxs">
            {showMore ? "More" : "What do you want to find out?"}
          </motion.h1>
          <motion.p variants={fadeUp} className="text-s text-muted-foreground pt-xxs pb-l">
            {showMore ? "For your team, your hiring, or anything else." : "Pick one. The agent does the rest."}
          </motion.p>

          {showMore ? (
            <div className="flex flex-col gap-s pb-l">{MORE.map((s) => card(s, true))}</div>
          ) : (
            <div className="grid grid-cols-2 gap-s pb-l">
              {DECK.map((s) => card(s, false))}
              <motion.button
                variants={fadeUp}
                type="button"
                onClick={openMore}
                disabled={busy}
                data-testid="shape-more"
                className={`col-span-2 flex flex-row items-center gap-m bg-transparent shadow-edge-transparent hover:bg-card ${cardClass}`}
              >
                <Ellipsis size={22} aria-hidden className="shrink-0 text-neutral-8" />
                <span className="flex flex-col gap-xxs">
                  <span className="text-m font-medium text-foreground">More</span>
                  <span className="text-xs text-muted-foreground">ask your team, check references, or your own words</span>
                </span>
              </motion.button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

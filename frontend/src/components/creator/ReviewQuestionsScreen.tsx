import { useState, useRef, useEffect, useCallback } from "react";
import { motion, Reorder, useDragControls, AnimatePresence } from "framer-motion";
import { Camera, GripVertical, LoaderCircle, Mic, Plus, RefreshCw, Sparkles, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { stagger, fadeUp, transitionLarge, transitionSmall } from "@/lib/animations";

export type ReviewQuestion = {
  text: string;
  hint?: string;
  type?: "voice" | "photo" | "video";
};

interface ReviewQuestionsScreenProps {
  questions: ReviewQuestion[];
  onConfirm: (questions: ReviewQuestion[]) => void;
  onRegenerate: () => void;
  /** Chips: the whole draft rewritten in place (same count, order, type); null when it failed (texts stay). */
  onAdjust?: (kind: "shorter" | "playful", current: ReviewQuestion[]) => Promise<ReviewQuestion[] | null>;
  /** Chip: the optional follow-up loop, then a rebuild. */
  /** "Sharpen it": hands up the draft as it stands so the follow-up loop can edit *this* list, swaps and all. */
  onSharpen?: (current: ReviewQuestion[]) => void;
  /** The draft is being edited with the creator's follow-up answers: cards dim, actions wait. */
  revising?: boolean;
  /** Bump to re-seed the cards from `questions` (after a revision lands). */
  revisionKey?: number;
  /** Per-question swap: resolves to the replacement, or null when it failed (the card keeps its text). */
  onSwap?: (index: number, current: ReviewQuestion[]) => Promise<ReviewQuestion | null>;
  /** What the agent will hand back to the group (the chosen shape's report). */
  reportPreview?: string | null;
  /** Parent is fetching the first follow-up. */
  busy?: boolean;
}

function ReviewChip({
  onClick,
  children,
  testId,
  disabled = false,
  busy = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
  disabled?: boolean;
  /** This chip's request is in flight: it keeps its colour and shows a spinner. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      data-testid={testId}
      data-busy={busy}
      className={`inline-flex items-center gap-xxs rounded-full bg-muted px-m py-xs text-s font-medium transition-[background-color,color,transform] hover:bg-neutral-4 active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none ${
        busy ? "text-foreground" : "text-foreground disabled:text-neutral-6"
      }`}
    >
      {busy && (
        <motion.span className="flex" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
          <LoaderCircle size={14} aria-hidden />
        </motion.span>
      )}
      {children}
    </button>
  );
}

interface QuestionItem {
  id: string;
  text: string;
  hint?: string;
  type: "voice" | "photo" | "video";
}

let nextId = 0;
function makeId() {
  return `q-${++nextId}-${Date.now()}`;
}

/** Small chip showing whether a question is voice, photo, or video, so the
 *  creator sees at a glance what the AI picked per question (future: tap to
 *  change the type). The visible label is asserted exactly by the creator
 *  e2e spec — keep "Voice" / "Photo" / "Video". */
function MediaTypeBadge({ type }: { type: "voice" | "photo" | "video" }) {
  const label = type === "voice" ? "Voice" : type === "photo" ? "Photo" : "Video";
  const Icon = type === "voice" ? Mic : type === "photo" ? Camera : Video;
  return (
    <span
      className="shrink-0 inline-flex items-center gap-xxs rounded-full bg-muted px-s py-xxs text-xs font-medium text-neutral-8"
      title={`${label} answer`}
    >
      <Icon size={12} aria-hidden />
      {label}
    </span>
  );
}

function QuestionCard({
  item,
  index,
  isEditing,
  onTap,
  onChange,
  onDelete,
  canDelete,
  onSwap,
  swapping,
  dimmed = false,
}: {
  item: QuestionItem;
  index: number;
  isEditing: boolean;
  onTap: () => void;
  onChange: (value: string) => void;
  onDelete: () => void;
  canDelete: boolean;
  onSwap?: () => void;
  swapping: boolean;
  /** A rewrite of the whole draft is in flight. */
  dimmed?: boolean;
}) {
  const dragControls = useDragControls();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
    // Scroll the card into view when editing starts
    if (isEditing && cardRef.current) {
      // Small delay to let the keyboard finish opening
      setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }, [isEditing]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, [isEditing, item.text]);

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={dragControls}
      className="list-none touch-none rounded-m"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40, transition: transitionSmall }}
      transition={{ ...transitionLarge, delay: 0.04 * (index + 1) }}
      whileDrag={{ zIndex: 50, boxShadow: "var(--shadow-m)" }}
    >
      {/* While editing, the card carries the focus indicator (accent edge)
          because the inline textarea below is drawn without its own outline. */}
      <div
        ref={cardRef}
        className={`relative flex items-stretch overflow-hidden rounded-m bg-card transition-[box-shadow,opacity] ${isEditing ? "shadow-edge-accent" : ""} ${
          dimmed || swapping ? "opacity-60" : ""
        }`}
        data-dimmed={dimmed || swapping}
      >
        {/* Drag rail: the whole left edge of the card, top to bottom, is the handle.
            It carries the number too, so the text keeps its width on a 320px phone. */}
        <div
          className="relative shrink-0 flex w-11 items-center justify-center bg-muted text-neutral-8 cursor-grab active:cursor-grabbing touch-none transition-colors hover:bg-neutral-4"
          onPointerDown={(e) => dragControls.start(e)}
          aria-label="Drag to reorder"
          role="button"
          data-testid="review-drag-rail"
        >
          <span className="absolute inset-x-0 top-m text-center font-data text-xs font-medium tabular-nums" aria-hidden>
            {index + 1}
          </span>
          <GripVertical size={18} aria-hidden />
        </div>

        {/* Question text + media-type badge — tap text to edit */}
        <div className="flex-1 ml-s min-w-0 flex flex-col gap-xs py-m text-foreground">
          {isEditing ? (
            <Textarea
              ref={textareaRef}
              value={item.text}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onTap}
              className="min-h-10 rounded-none bg-transparent px-zero py-zero text-m font-medium caret-color-1 focus-visible:outline-none"
            />
          ) : (
            <button type="button" onClick={onTap} className="text-left text-m font-medium min-h-10">
              {/* Keyed by the text so a rewrite or swap fades the new wording in. */}
              <motion.span
                key={item.text}
                className="block"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={transitionSmall}
              >
                {item.text || <span className="text-neutral-6">Tap to write question...</span>}
              </motion.span>
            </button>
          )}
          <div className="flex">
            <MediaTypeBadge type={item.type} />
          </div>
        </div>

        {/* Swap and delete, stacked in one column so the text keeps its width. */}
        <div className="shrink-0 flex flex-col items-center py-s mr-xxs">
        {onSwap && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onSwap}
            disabled={swapping}
            aria-label="Swap this question"
            className="shrink-0 text-muted-foreground"
            data-testid="review-swap"
            data-swapping={swapping}
          >
            <motion.span
              className="flex"
              animate={swapping ? { rotate: 360 } : { rotate: 0 }}
              transition={swapping ? { duration: 1, repeat: Infinity, ease: "linear" } : transitionSmall}
            >
              <RefreshCw aria-hidden />
            </motion.span>
          </Button>
        )}

        {/* Delete */}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Delete question"
            className="shrink-0 text-muted-foreground hover:bg-error-transparent hover:text-error"
          >
            <Trash2 aria-hidden />
          </Button>
        )}
        </div>
      </div>
    </Reorder.Item>
  );
}

export default function ReviewQuestionsScreen({
  questions,
  onConfirm,
  onRegenerate,
  onAdjust,
  onSharpen,
  onSwap,
  reportPreview = null,
  busy = false,
  revising = false,
  revisionKey = 0,
}: ReviewQuestionsScreenProps) {
  const seed = (qs: ReviewQuestion[]): QuestionItem[] =>
    qs.map((q) => ({
      id: makeId(),
      text: q.text,
      hint: q.hint,
      type: q.type ?? "voice",
    }));
  const [items, setItems] = useState<QuestionItem[]>(() => seed(questions));
  const seededFor = useRef(revisionKey);
  useEffect(() => {
    if (seededFor.current === revisionKey) return;
    seededFor.current = revisionKey;
    setItems(seed(questions));
    setEditingIndex(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionKey]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<"shorter" | "playful" | null>(null);
  void onRegenerate;

  /** A chip: rewrite every card in place, keeping ids (and so order and drag state). */
  const adjust = async (kind: "shorter" | "playful") => {
    if (!onAdjust || adjusting || swappingId || revising) return;
    setAdjusting(kind);
    try {
      const result = await onAdjust(
        kind,
        items.map((q) => ({ text: q.text, hint: q.hint, type: q.type })),
      );
      if (result) {
        setItems((prev) =>
          prev.map((it, i) =>
            result[i] ? { ...it, text: result[i].text, hint: result[i].hint ?? it.hint, type: result[i].type ?? it.type } : it,
          ),
        );
      }
    } finally {
      setAdjusting(null);
    }
  };

  const swap = async (index: number) => {
    if (!onSwap || swappingId || revising) return;
    const target = items[index];
    if (!target) return;
    setSwappingId(target.id);
    try {
      const replacement = await onSwap(
        index,
        items.map((q) => ({ text: q.text, hint: q.hint, type: q.type })),
      );
      if (replacement) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === target.id
              ? { ...it, text: replacement.text, hint: replacement.hint ?? it.hint, type: replacement.type ?? it.type }
              : it,
          ),
        );
      }
    } finally {
      setSwappingId(null);
    }
  };

  const updateQuestion = (id: string, value: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, text: value } : item)));
  };

  const deleteQuestion = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setEditingIndex(null);
  };

  const addQuestion = () => {
    // Manually-added questions default to voice — user can't pick the type
    // here yet. (Future: add a long-press or context menu to switch.)
    const newItem: QuestionItem = { id: makeId(), text: "", type: "voice" };
    setItems((prev) => [...prev, newItem]);
    setTimeout(() => setEditingIndex(items.length), 50);
  };

  const canConfirm = items.length > 0 && items.every((q) => q.text.trim().length > 0);
  const isEditing = editingIndex !== null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Top zone — collapses when the keyboard is open (editing) */}
      <div
        className={`shrink-0 px-l overflow-hidden transition-all duration-large ease-large ${
          isEditing ? "max-h-0 pt-xs pb-zero opacity-0" : "max-h-80 pt-xxl pb-xs opacity-100"
        }`}
      >
        <motion.div
          variants={stagger}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center gap-xl text-center"
        >
          <motion.span
            variants={fadeUp}
            className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground"
          >
            Parlo
          </motion.span>

          <div className="flex flex-col gap-s">
            <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground">
              Review your questions
            </motion.h1>
            <motion.p variants={fadeUp} className="text-s text-muted-foreground">
              Tap to edit, drag to reorder.
            </motion.p>
            {(onAdjust || onSharpen) && (
              <motion.div variants={fadeUp} className="flex flex-wrap justify-center gap-xs pt-xs">
                {onAdjust && (
                  <ReviewChip
                    onClick={() => void adjust("shorter")}
                    testId="review-adjust-shorter"
                    busy={adjusting === "shorter"}
                    disabled={!!adjusting || !!swappingId}
                  >
                    Shorter
                  </ReviewChip>
                )}
                {onAdjust && (
                  <ReviewChip
                    onClick={() => void adjust("playful")}
                    testId="review-adjust-playful"
                    busy={adjusting === "playful"}
                    disabled={!!adjusting || !!swappingId}
                  >
                    More playful
                  </ReviewChip>
                )}
                {onSharpen && (
                  <ReviewChip
                    onClick={() => onSharpen(items.map((q) => ({ text: q.text, hint: q.hint, type: q.type })))}
                    testId="review-sharpen"
                    disabled={busy || !!adjusting || revising}
                  >
                    <Sparkles size={14} aria-hidden />
                    {busy ? "Thinking…" : "Sharpen it"}
                  </ReviewChip>
                )}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Content zone */}
      <motion.div
        className="flex-1 min-h-0 overflow-y-auto px-l pt-xl pb-xs"
        variants={fadeUp}
        initial="initial"
        animate="animate"
      >
        <Reorder.Group axis="y" values={items} onReorder={setItems} className="list-none space-y-s">
          <AnimatePresence initial={false}>
            {items.map((item, i) => (
              <QuestionCard
                key={item.id}
                item={item}
                index={i}
                isEditing={editingIndex === i}
                onTap={() => setEditingIndex(editingIndex === i ? null : i)}
                onChange={(value) => updateQuestion(item.id, value)}
                onDelete={() => deleteQuestion(item.id)}
                canDelete={items.length > 1}
                onSwap={onSwap && !adjusting ? () => void swap(i) : undefined}
                swapping={swappingId === item.id}
                dimmed={!!adjusting || revising}
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>

        <Button type="button" variant="secondary" className="w-full mt-m" onClick={addQuestion}>
          <Plus aria-hidden />
          Add question
        </Button>

        {reportPreview && (
          <div className="mt-l rounded-m bg-card p-m flex flex-col gap-xs" data-testid="review-report-preview">
            <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
              What comes back to the group
            </span>
            <p className="text-s text-foreground">{reportPreview}</p>
          </div>
        )}
      </motion.div>

      {/* Action zone — hidden when keyboard is open */}
      <motion.div
        className={`shrink-0 px-l relative overflow-hidden transition-all duration-large ease-large ${
          isEditing ? "max-h-0 pt-zero pb-zero opacity-0" : "max-h-32 pt-m pb-safe opacity-100"
        }`}
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* Scroll fade above the action zone */}
        <div
          className="absolute inset-x-0 -top-8 h-8 pointer-events-none bg-gradient-to-b from-transparent to-background"
          aria-hidden
        />
        <motion.div variants={fadeUp}>
          <Button
            size="lg"
            className="w-full"
            onClick={() =>
              onConfirm(
                items
                  .filter((q) => q.text.trim())
                  .map((q) => ({ text: q.text, hint: q.hint, type: q.type })),
              )
            }
            disabled={!canConfirm}
          >
            Confirm & go live
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}

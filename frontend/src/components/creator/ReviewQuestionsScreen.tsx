import { useState, useRef, useEffect, useCallback, type SyntheticEvent } from "react";
import { motion, Reorder, useDragControls, AnimatePresence } from "framer-motion";
import { Camera, GripVertical, LoaderCircle, Mic, Plus, RefreshCw, Sparkles, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
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

type MediaType = "voice" | "photo" | "video";
const MEDIA_TYPES: { type: MediaType; label: string; Icon: typeof Mic }[] = [
  { type: "voice", label: "Voice", Icon: Mic },
  { type: "photo", label: "Photo", Icon: Camera },
  { type: "video", label: "Video", Icon: Video },
];

/** The chip showing whether a question is answered by voice, photo or video.
 *  Tap it and it opens into the three options in the same row; tap one and
 *  it closes on the pick. The visible label is asserted exactly by the
 *  creator e2e spec — keep "Voice" / "Photo" / "Video". */
function MediaTypePicker({ type, onChange }: { type: MediaType; onChange: (type: MediaType) => void }) {
  const [open, setOpen] = useState(false);
  const current = MEDIA_TYPES.find((m) => m.type === type) ?? MEDIA_TYPES[0];
  // Pressing the chip must not move focus: while the question's textarea is
  // being edited the header is collapsed for the keyboard, and a blur would
  // end editing, spring the header back and drop the keyboard (the jump
  // reported on 2026-10-15). Cancelling the press keeps the caret where it is.
  const keepFocus = (e: SyntheticEvent) => e.preventDefault();
  if (!open) {
    return (
      <button
        type="button"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() => setOpen(true)}
        className="shrink-0 inline-flex items-center gap-xxs rounded-full bg-muted px-s py-xxs text-xs font-medium text-neutral-8 transition-colors hover:bg-neutral-4 active:translate-y-press"
        aria-label={`${current.label} answer. Change how it's answered`}
        aria-haspopup="listbox"
        aria-expanded={false}
        data-testid="review-type"
        data-type={type}
      >
        <current.Icon size={12} aria-hidden />
        {current.label}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-xxs" role="listbox" aria-label="How it's answered" data-testid="review-type-options">
      {MEDIA_TYPES.map((m) => {
        const selected = m.type === type;
        return (
          <button
            key={m.type}
            type="button"
            role="option"
            aria-selected={selected}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => {
              onChange(m.type);
              setOpen(false);
            }}
            className={`inline-flex items-center gap-xxs rounded-full px-s py-xxs text-xs font-medium transition-colors active:translate-y-press ${
              selected ? "bg-primary text-primary-foreground" : "bg-muted text-neutral-8 hover:bg-neutral-4"
            }`}
            data-testid="review-type-option"
            data-type={m.type}
          >
            <m.Icon size={12} aria-hidden />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function QuestionCard({
  item,
  index,
  isEditing,
  onTap,
  onChange,
  onTypeChange,
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
  onTypeChange: (type: MediaType) => void;
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
      {/* No edge while editing: the caret and the keyboard say enough. */}
      <div
        ref={cardRef}
        className={`relative flex items-stretch overflow-hidden rounded-m bg-card transition-[box-shadow,opacity] ${
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
            <textarea
              ref={textareaRef}
              value={item.text}
              onChange={(e) => onChange(e.target.value)}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && cardRef.current?.contains(next)) {
                  textareaRef.current?.focus();
                  return;
                }
                onTap();
              }}
              rows={1}
              placeholder="Write the question"
              aria-label={`Question ${index + 1}`}
              className="w-full min-h-10 resize-none bg-transparent p-zero font-ui text-m font-medium text-foreground placeholder:text-neutral-6 caret-color-1 outline-none ring-0 shadow-none"
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
            <MediaTypePicker type={item.type} onChange={onTypeChange} />
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

  const updateType = (id: string, type: MediaType) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, type } : item)));
  };

  const deleteQuestion = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setEditingIndex(null);
  };

  const addQuestion = () => {
    // A new question is voice until the creator taps its chip to make it photo or video.
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
                onTypeChange={(type) => updateType(item.id, type)}
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

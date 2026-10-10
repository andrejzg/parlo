import { useState, useRef, useEffect, useCallback } from "react";
import { motion, Reorder, useDragControls, AnimatePresence } from "framer-motion";
import { Camera, GripVertical, Mic, Plus, Trash2, Video } from "lucide-react";
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
}: {
  item: QuestionItem;
  index: number;
  isEditing: boolean;
  onTap: () => void;
  onChange: (value: string) => void;
  onDelete: () => void;
  canDelete: boolean;
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
        className={`relative flex items-start rounded-m bg-card p-m transition-shadow ${isEditing ? "shadow-edge-accent" : ""}`}
      >
        {/* Drag handle */}
        <div
          className="shrink-0 flex items-center justify-center w-11 h-11 -ml-xxs cursor-grab active:cursor-grabbing touch-none text-neutral-6"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <GripVertical size={16} aria-hidden />
        </div>

        {/* Number — sized to the first text line so it reads as its label */}
        <span className="shrink-0 flex h-6 w-5 items-center justify-center mt-xxs font-data text-xs font-medium tabular-nums text-muted-foreground">
          {index + 1}
        </span>

        {/* Question text + media-type badge — tap text to edit */}
        <div className="flex-1 ml-s min-w-0 flex flex-col gap-xs py-xxs text-foreground">
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
              {item.text || <span className="text-neutral-6">Tap to write question...</span>}
            </button>
          )}
          <div className="flex">
            <MediaTypeBadge type={item.type} />
          </div>
        </div>

        {/* Delete */}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Delete question"
            className="shrink-0 -mr-xxs text-muted-foreground hover:bg-error-transparent hover:text-error"
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </Reorder.Item>
  );
}

export default function ReviewQuestionsScreen({
  questions,
  onConfirm,
  onRegenerate,
}: ReviewQuestionsScreenProps) {
  const [items, setItems] = useState<QuestionItem[]>(() =>
    questions.map((q) => ({
      id: makeId(),
      text: q.text,
      hint: q.hint,
      type: q.type ?? "voice",
    }))
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

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
              />
            ))}
          </AnimatePresence>
        </Reorder.Group>

        <Button type="button" variant="secondary" className="w-full mt-m" onClick={addQuestion}>
          <Plus aria-hidden />
          Add question
        </Button>
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

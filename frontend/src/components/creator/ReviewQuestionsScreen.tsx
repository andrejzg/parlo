import { useState, useRef, useEffect, useCallback } from "react";
import { motion, Reorder, useDragControls, AnimatePresence } from "framer-motion";
import { stagger, fadeUp } from "@/lib/animations";

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

/** Small icon badge showing whether a question is voice, photo, or video.
 *  Lets the creator see at a glance what the AI picked per question, and
 *  (future) tap to change the type. Uses the same SVG-inline style as the
 *  other icons on this screen to avoid an icon-library dependency. */
function MediaTypeBadge({ type }: { type: "voice" | "photo" | "video" }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "hsl(var(--primary) / 0.75)",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const label = type === "voice" ? "Voice" : type === "photo" ? "Photo" : "Video";
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-display uppercase tracking-wider"
      style={{
        background: "hsl(22 95% 62% / 0.1)",
        color: "hsl(var(--primary) / 0.9)",
        border: "1px solid hsl(22 95% 62% / 0.2)",
      }}
      title={`${label} answer`}
    >
      {type === "voice" ? (
        <svg {...common}>
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      ) : type === "photo" ? (
        <svg {...common}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      ) : (
        <svg {...common}>
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      )}
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
      className="touch-none"
      style={{ listStyle: "none" }}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      transition={{ delay: 0.1 + index * 0.07, duration: 0.35 }}
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: 50,
      }}
    >
      <div
        ref={cardRef}
        className="flex items-start rounded-2xl px-4 py-4 relative transition-colors duration-150"
        style={{
          background: isEditing ? "hsl(225 15% 13%)" : "hsl(225 15% 10%)",
          border: isEditing ? "1px solid hsl(225 15% 20%)" : "1px solid transparent",
        }}
      >
        {/* Drag handle */}
        <div
          className="shrink-0 flex items-center justify-center w-11 h-11 -ml-1 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="3.5" cy="2" r="1.3" fill="hsl(225 10% 30%)" />
            <circle cx="10.5" cy="2" r="1.3" fill="hsl(225 10% 30%)" />
            <circle cx="3.5" cy="7" r="1.3" fill="hsl(225 10% 30%)" />
            <circle cx="10.5" cy="7" r="1.3" fill="hsl(225 10% 30%)" />
            <circle cx="3.5" cy="12" r="1.3" fill="hsl(225 10% 30%)" />
            <circle cx="10.5" cy="12" r="1.3" fill="hsl(225 10% 30%)" />
          </svg>
        </div>

        {/* Number */}
        <span
          className="shrink-0 w-5 text-center font-display text-xs font-semibold leading-none mt-[0.65rem]"
          style={{ color: "hsl(var(--primary) / 0.5)" }}
        >
          {index + 1}
        </span>

        {/* Question text + media-type badge — tap text to edit */}
        <div className="flex-1 ml-3 min-w-0 flex flex-col gap-1.5 py-1">
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={item.text}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onTap}
              className="bg-transparent border-none outline-none resize-none font-display text-base leading-relaxed min-h-[2.5rem]"
              style={{
                color: "hsl(40 20% 95%)",
                fontWeight: 600,
                caretColor: "hsl(var(--primary))",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={onTap}
              className="text-left font-display text-base leading-relaxed min-h-[2.5rem]"
              style={{
                color: "hsl(40 20% 95%)",
                fontWeight: 600,
              }}
            >
              {item.text || <span style={{ color: "hsl(225 10% 35%)" }}>Tap to write question...</span>}
            </button>
          )}
          <div className="flex">
            <MediaTypeBadge type={item.type} />
          </div>
        </div>

        {/* Delete */}
        {canDelete && (
          <motion.button
            type="button"
            onClick={onDelete}
            className="shrink-0 flex items-center justify-center w-11 h-11 -mr-1 rounded-full hover:bg-destructive/10 transition-colors"
            whileTap={{ scale: 0.85 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 35%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </motion.button>
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
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Top zone — collapses when keyboard is open (editing) */}
      <div
        className="shrink-0 px-6 overflow-hidden transition-all duration-300"
        style={{
          paddingTop: isEditing ? "0.5rem" : "3.5rem",
          paddingBottom: isEditing ? "0" : "0.5rem",
          maxHeight: isEditing ? "0px" : "300px",
          opacity: isEditing ? 0 : 1,
        }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.45 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-center gap-2 mb-8"
        >
          <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
          <span
            className="text-xs font-display tracking-widest uppercase"
            style={{ color: "hsl(225 10% 55%)" }}
          >
            Parlo
          </span>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="initial"
          animate="animate"
          className="text-center"
        >
          <motion.h1
            variants={fadeUp}
            className="font-display leading-tight"
            style={{
              fontSize: "clamp(2rem, 8vw, 2.6rem)",
              fontWeight: 800,
              color: "hsl(40 20% 95%)",
            }}
          >
            Review your
            <br />
            questions
          </motion.h1>
          <motion.p
            variants={fadeUp}
            className="mt-3 text-base leading-relaxed font-light"
            style={{ color: "hsl(225 10% 55%)" }}
          >
            Tap to edit, drag to reorder.
          </motion.p>
        </motion.div>
      </div>

      {/* Content zone */}
      <motion.div
        className="flex-1 min-h-0 overflow-y-auto px-5 pt-8 pb-2"
        variants={fadeUp}
        initial="initial"
        animate="animate"
      >
        <Reorder.Group
          axis="y"
          values={items}
          onReorder={setItems}
          className="space-y-2.5"
          style={{ listStyle: "none", padding: 0, margin: 0 }}
        >
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

        <motion.button
          type="button"
          onClick={addQuestion}
          className="w-full mt-4 py-3.5 rounded-2xl border border-dashed flex items-center justify-center gap-2.5 font-display text-sm font-medium transition-colors"
          style={{
            borderColor: "hsl(225 15% 18%)",
            color: "hsl(225 10% 40%)",
          }}
          whileTap={{ scale: 0.97 }}
          whileHover={{ borderColor: "hsl(225 15% 28%)", color: "hsl(225 10% 55%)" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add question
        </motion.button>
      </motion.div>

      {/* Action zone — hidden when keyboard is open */}
      <motion.div
        className="shrink-0 px-6 pt-4 pb-8 relative overflow-hidden transition-all duration-300"
        variants={stagger}
        initial="initial"
        animate="animate"
        style={{
          maxHeight: isEditing ? "0px" : "120px",
          paddingTop: isEditing ? "0" : undefined,
          paddingBottom: isEditing ? "0" : undefined,
          opacity: isEditing ? 0 : 1,
        }}
      >
        {/* Gradient fade above action zone */}
        <div
          className="absolute inset-x-0 -top-8 h-8 pointer-events-none"
          style={{
            background: "linear-gradient(to bottom, transparent, hsl(225 25% 4%))",
          }}
        />
        <motion.button
          variants={fadeUp}
          onClick={() =>
            onConfirm(
              items
                .filter((q) => q.text.trim())
                .map((q) => ({ text: q.text, hint: q.hint, type: q.type })),
            )
          }
          disabled={!canConfirm}
          className="w-full py-5 rounded-2xl font-display text-lg tracking-wide glow-primary disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            fontWeight: 700,
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
          whileTap={canConfirm ? { scale: 0.96, transition: { duration: 0.07 } } : {}}
          whileHover={canConfirm ? { filter: "brightness(1.12)", transition: { duration: 0.12 } } : {}}
        >
          Confirm & go live
        </motion.button>

      </motion.div>
    </div>
  );
}

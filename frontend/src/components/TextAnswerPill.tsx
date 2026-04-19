import { motion } from "framer-motion";

interface TextAnswerPillProps {
  text: string;
  onEdit: () => void;
  onDelete: () => void;
}

export default function TextAnswerPill({ text, onEdit, onDelete }: TextAnswerPillProps) {
  return (
    <motion.div
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-4"
      style={{ background: "hsl(225 15% 11%)", border: "1px solid hsl(225 15% 18%)" }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Edit button — 44px touch target */}
      <motion.button
        type="button"
        onClick={onEdit}
        className="shrink-0 flex items-center justify-center w-11 h-11 rounded-full transition-colors"
        style={{ background: "hsl(225 15% 16%)" }}
        whileTap={{ scale: 0.9 }}
        whileHover={{ background: "hsl(225 15% 20%)" }}
        aria-label="Edit answer"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 55%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      </motion.button>

      {/* Text preview — tappable */}
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 text-left text-sm leading-relaxed py-1 line-clamp-3 transition-colors"
        style={{ color: "hsl(40 20% 80%)" }}
      >
        {text}
      </button>

      {/* Delete — 44px touch target */}
      <motion.button
        type="button"
        onClick={onDelete}
        className="shrink-0 flex items-center justify-center w-11 h-11 -mr-1 rounded-full hover:bg-destructive/10 transition-colors"
        whileTap={{ scale: 0.85 }}
        aria-label="Delete answer"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 38%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </motion.button>
    </motion.div>
  );
}

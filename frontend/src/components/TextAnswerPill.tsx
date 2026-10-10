import { motion } from "framer-motion";
import { Pencil, Trash2 } from "lucide-react";
import { press, transitionSmall } from "@/lib/animations";

interface TextAnswerPillProps {
  text: string;
  onEdit: () => void;
  onDelete: () => void;
}

export default function TextAnswerPill({ text, onEdit, onDelete }: TextAnswerPillProps) {
  return (
    <motion.div
      className="w-full flex items-center gap-s rounded-m bg-card px-m py-s"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitionSmall}
    >
      {/* Edit button — 44px touch target */}
      <motion.button
        type="button"
        onClick={onEdit}
        className="shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-neutral-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
        whileTap={press}
        aria-label="Edit answer"
      >
        <Pencil size={16} aria-hidden />
      </motion.button>

      {/* Text preview — tappable */}
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 text-left text-s text-neutral-8 py-xxs line-clamp-3 transition-colors hover:text-foreground"
      >
        {text}
      </button>

      {/* Delete — 44px touch target */}
      <motion.button
        type="button"
        onClick={onDelete}
        className="shrink-0 flex items-center justify-center w-11 h-11 -mr-xxs rounded-full text-muted-foreground transition-colors hover:bg-error-transparent hover:text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
        whileTap={press}
        aria-label="Delete answer"
      >
        <Trash2 size={16} aria-hidden />
      </motion.button>
    </motion.div>
  );
}

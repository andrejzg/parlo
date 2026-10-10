import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Keyboard, Mic } from "lucide-react";
import { transitionSmall } from "@/lib/animations";

export type BriefMode = "voice" | "text";

interface CreateModeSheetProps {
  open: boolean;
  /** The parlo is being created for the chosen mode — tiles lock until it lands. */
  busy?: boolean;
  onClose: () => void;
  onChoose: (mode: BriefMode) => void;
}

const sheetSpring = { type: "spring" as const, visualDuration: 0.28, bounce: 0.2 };

const tileClass =
  "flex flex-col items-center justify-center gap-s rounded-m bg-muted px-m py-l text-foreground transition-[background-color,transform] hover:bg-neutral-4 active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none disabled:text-neutral-6";

/**
 * Opens from the tab bar's "+" — the creator picks whether to describe the
 * new agent out loud or by typing. The brief screen then starts in that mode
 * (either way they can switch later without losing anything).
 */
export default function CreateModeSheet({ open, busy = false, onClose, onChoose }: CreateModeSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="absolute inset-0 z-40 bg-neutral-1-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transitionSmall}
            onClick={busy ? undefined : onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-mode-title"
            className="absolute inset-x-0 bottom-0 z-50 rounded-t-xl bg-card shadow-m px-l pt-l pb-safe"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: transitionSmall }}
            transition={sheetSpring}
            data-testid="create-mode-sheet"
          >
            <h2 id="create-mode-title" className="font-brand text-l font-heavy text-foreground mb-m">
              Create a parlo
            </h2>
            <div className="grid grid-cols-2 gap-s">
              <button
                type="button"
                className={tileClass}
                onClick={() => onChoose("voice")}
                disabled={busy}
                data-testid="create-mode-voice"
              >
                <Mic size={28} aria-hidden />
                <span className="text-m font-medium">Voice</span>
              </button>
              <button
                type="button"
                className={tileClass}
                onClick={() => onChoose("text")}
                disabled={busy}
                data-testid="create-mode-text"
              >
                <Keyboard size={28} aria-hidden />
                <span className="text-m font-medium">Type</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

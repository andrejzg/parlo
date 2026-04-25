import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import imageCompression from "browser-image-compression";
import { SurveyQuestion, VoiceAnswer } from "@/types/survey";
import { captureException } from "@/lib/posthog";

interface PhotoQuestionScreenProps {
  question: SurveyQuestion;
  questionIndex: number;
  totalQuestions: number;
  isLast: boolean;
  existingAnswer?: VoiceAnswer;
  /** True when the participant tapped "Redo this answer" — the camera will
   *  auto-open on mount so they skip the "Use this / Retake" confirmation of
   *  a capture they've explicitly decided to replace. */
  isRedo?: boolean;
  onNext: (answer: VoiceAnswer) => void;
  onBack?: () => void;
  onDeleteAnswer?: () => void;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

const item = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

const questionItem = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function PhotoQuestionScreen({
  question,
  questionIndex,
  totalQuestions,
  isLast,
  existingAnswer,
  isRedo,
  onNext,
  onBack,
}: PhotoQuestionScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(existingAnswer?.blob ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingAnswer?.url ?? null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = ((questionIndex + 1) / totalQuestions) * 100;

  // NOTE: We intentionally do NOT revoke the object URL on unmount. When the
  // user confirms a photo, we pass the URL up to the parent which uses it in
  // the Review / ThankYou screens. Unmount-time revocation would kill those
  // downstream previews. We do revoke inline in handleFile/handleRetake when
  // replacing the URL with a new one.

  const triggerCamera = () => {
    fileInputRef.current?.click();
  };

  // Redo mode: auto-open the camera on mount so the user goes straight from
  // "Redo this answer" into their camera, skipping the preview/confirm of the
  // old capture. The existing blob/preview stays in state as a fallback: if
  // the user cancels the native file picker, they see the previous photo
  // again and can tap Retake or Use this as normal. Works because the "Redo"
  // click in ReviewScreen is a recent user gesture and browsers allow
  // programmatic `.click()` on file inputs within a short window after one.
  useEffect(() => {
    if (isRedo) {
      const id = window.setTimeout(() => triggerCamera(), 60);
      return () => window.clearTimeout(id);
    }
    // Only fire once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsCompressing(true);

    try {
      // Compress to ~1MB JPEG, max 1080px on the long edge.
      // fileType: 'image/jpeg' forces conversion from HEIC if needed.
      const compressed = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1080,
        useWebWorker: true,
        fileType: "image/jpeg",
        initialQuality: 0.85,
      });

      // Revoke any previous preview URL
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }

      const url = URL.createObjectURL(compressed);
      setPhotoBlob(compressed);
      setPreviewUrl(url);
    } catch (err) {
      captureException(err, { location: "PhotoQuestionScreen.handleFile", questionId: question.id });
      setError("Couldn't process that photo. Please try again.");
    } finally {
      setIsCompressing(false);
      // Reset the input so the same file can be selected again on retake
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRetake = () => {
    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
    setPhotoBlob(null);
    setPreviewUrl(null);
    setError(null);
    // Open camera immediately
    setTimeout(() => triggerCamera(), 50);
  };

  const handleConfirm = () => {
    if (!photoBlob) return;
    onNext({
      questionId: question.id,
      blob: photoBlob,
      url: previewUrl ?? undefined,
      durationMs: 0,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Hidden native file input — opens the OS camera on iOS/Android */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />

      {/* Progress bar */}
      <div className="w-full h-0.5 bg-muted">
        <motion.div
          className="h-full bg-primary origin-left"
          initial={{ scaleX: questionIndex / totalQuestions }}
          animate={{ scaleX: progress / 100 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: "left" }}
        />
      </div>

      {/* Header */}
      <motion.div
        className="flex items-center justify-between px-6 pt-4 pb-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <div className="flex items-center gap-3">
          {onBack && (
            <motion.button
              type="button"
              onClick={onBack}
              className="flex items-center justify-center w-11 h-11 -ml-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              whileTap={{ scale: 0.9 }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </motion.button>
          )}
          <span className="font-display text-xs text-muted-foreground tracking-widest uppercase">
            {questionIndex + 1} / {totalQuestions}
          </span>
        </div>
        <span className="font-display text-xs text-muted-foreground tracking-widest uppercase">
          PHOTO
        </span>
      </motion.div>

      {/* Question — centre stage */}
      <motion.div
        className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 gap-6 overflow-y-auto"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {question.hint && (
          <motion.p variants={item} className="text-muted-foreground text-sm text-center">
            {question.hint}
          </motion.p>
        )}
        <motion.h2
          variants={questionItem}
          className="font-serif text-2xl sm:text-4xl leading-snug text-center text-foreground"
          style={{ fontWeight: 600 }}
        >
          {question.text}
        </motion.h2>

        {/* Photo preview or capture button */}
        <AnimatePresence mode="wait">
          {previewUrl ? (
            <motion.div
              key="preview"
              variants={item}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-sm"
            >
              <div className="rounded-2xl overflow-hidden border border-border shadow-lg">
                <img
                  src={previewUrl}
                  alt="Your answer"
                  className="w-full h-auto block"
                />
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="capture"
              variants={item}
              type="button"
              onClick={triggerCamera}
              disabled={isCompressing}
              className="flex items-center justify-center w-32 h-32 rounded-full bg-primary text-primary-foreground glow-primary disabled:opacity-50 select-none"
              whileTap={{ scale: 0.95 }}
              whileHover={{ filter: "brightness(1.12)" }}
            >
              {/* Camera icon */}
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>

        {isCompressing && (
          <p className="text-xs text-muted-foreground">Processing photo…</p>
        )}
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}
      </motion.div>

      {/* Bottom section */}
      <motion.div
        className="flex flex-col items-center gap-3 px-6 pb-safe flex-shrink-0"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {previewUrl ? (
          <div className="flex items-center gap-3 w-full max-w-sm">
            <button
              type="button"
              onClick={handleRetake}
              className="flex-1 py-4 rounded-2xl border border-border text-foreground font-display font-semibold text-base select-none"
              style={{ background: "hsl(225 15% 10%)" }}
            >
              Retake
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-4 rounded-2xl bg-primary text-primary-foreground font-display font-bold text-base glow-primary select-none"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center max-w-xs pb-2">
            Tap the camera to take a photo. You can retake before continuing.
          </p>
        )}
      </motion.div>
    </div>
  );
}

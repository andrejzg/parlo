import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SurveyQuestion, VoiceAnswer } from "@/types/survey";

interface VideoQuestionScreenProps {
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

const MAX_DURATION_S = 60;
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export default function VideoQuestionScreen({
  question,
  questionIndex,
  totalQuestions,
  isLast,
  existingAnswer,
  isRedo,
  onNext,
  onBack,
}: VideoQuestionScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(existingAnswer?.blob ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingAnswer?.url ?? null);
  const [durationMs, setDurationMs] = useState<number>(existingAnswer?.durationMs ?? 0);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = ((questionIndex + 1) / totalQuestions) * 100;

  // NOTE: We intentionally do NOT revoke the object URL on unmount. When the
  // user confirms a video, we pass the URL up to the parent which uses it in
  // the Review / ThankYou screens. Unmount-time revocation would kill those
  // downstream previews. We do revoke inline in handleFile/handleRetake when
  // replacing the URL with a new one.

  const triggerCamera = () => {
    fileInputRef.current?.click();
  };

  // Redo mode: auto-open the camera on mount. See PhotoQuestionScreen for
  // the rationale — works within the short post-gesture window browsers give
  // us after the Redo button click in ReviewScreen.
  useEffect(() => {
    if (isRedo) {
      const id = window.setTimeout(() => triggerCamera(), 60);
      return () => window.clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setValidating(true);

    try {
      // Check file size first (cheap)
      if (file.size > MAX_SIZE_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        throw new Error(`Video is ${sizeMb}MB — please record a shorter clip (max 25MB).`);
      }

      // Probe duration + dimensions via a hidden video element
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      v.src = url;

      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error("Couldn't read video metadata"));
        // Safety timeout
        setTimeout(() => reject(new Error("Video metadata timeout")), 8000);
      });

      const seconds = v.duration;
      const w = v.videoWidth;
      const h = v.videoHeight;

      if (!isFinite(seconds) || seconds <= 0) {
        URL.revokeObjectURL(url);
        throw new Error("Couldn't read the video — please try recording again.");
      }
      if (seconds > MAX_DURATION_S + 1) {
        URL.revokeObjectURL(url);
        throw new Error(`Video is ${Math.round(seconds)} seconds — please keep it under 60 seconds.`);
      }
      if (w > h) {
        URL.revokeObjectURL(url);
        throw new Error("Please record vertically (hold your phone upright).");
      }

      // Revoke any previous preview URL
      if (previewUrl && previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }

      setVideoBlob(file);
      setPreviewUrl(url);
      setDurationMs(Math.round(seconds * 1000));
    } catch (err) {
      console.error("[VideoQuestionScreen] capture failed:", err);
      setError(err instanceof Error ? err.message : "Couldn't process the video.");
    } finally {
      setValidating(false);
      // Reset the input so the same file can be selected again on retake
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRetake = () => {
    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
    setVideoBlob(null);
    setPreviewUrl(null);
    setDurationMs(0);
    setError(null);
    setTimeout(() => triggerCamera(), 50);
  };

  const handleConfirm = () => {
    if (!videoBlob) return;
    onNext({
      questionId: question.id,
      blob: videoBlob,
      url: previewUrl ?? undefined,
      durationMs,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Hidden native file input — opens the OS camera in video mode */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
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
          VIDEO · 60s
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
          className="font-display text-xl sm:text-3xl leading-snug text-center text-foreground"
          style={{ fontWeight: 800 }}
        >
          {question.text}
        </motion.h2>

        <AnimatePresence mode="wait">
          {previewUrl ? (
            <motion.div
              key="preview"
              variants={item}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-xs"
            >
              <div className="rounded-2xl overflow-hidden border border-border shadow-lg" style={{ background: "hsl(225 25% 4%)" }}>
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  muted
                  className="w-full h-auto block"
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">
                {(durationMs / 1000).toFixed(1)}s
              </p>
            </motion.div>
          ) : (
            <motion.button
              key="capture"
              variants={item}
              type="button"
              onClick={triggerCamera}
              disabled={validating}
              className="flex items-center justify-center w-32 h-32 rounded-full bg-primary text-primary-foreground glow-primary disabled:opacity-50 select-none"
              whileTap={{ scale: 0.95 }}
              whileHover={{ filter: "brightness(1.12)" }}
            >
              {/* Video camera icon */}
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>

        {validating && (
          <p className="text-xs text-muted-foreground">Checking video…</p>
        )}
        {error && (
          <p className="text-xs text-red-400 text-center max-w-xs">{error}</p>
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
            Tap to record. Keep it short and hold your phone upright.
          </p>
        )}
      </motion.div>
    </div>
  );
}

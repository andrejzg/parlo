import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Video } from "lucide-react";
import { SurveyQuestion, VoiceAnswer } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/posthog";
import { stagger, fadeUp, questionFadeUp, popup, transitionLarge } from "@/lib/animations";

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
      captureException(err, { location: "VideoQuestionScreen.handleFile", questionId: question.id });
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
      <div className="w-full h-xxs bg-muted">
        <motion.div
          className="h-full bg-color-1 origin-left"
          initial={{ scaleX: questionIndex / totalQuestions }}
          animate={{ scaleX: progress / 100 }}
          transition={transitionLarge}
          style={{ transformOrigin: "left" }}
        />
      </div>

      {/* Header */}
      <motion.div
        className="flex items-center justify-between px-l pt-m pb-xs"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        <div className="flex items-center gap-s">
          {onBack && (
            <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back" className="-ml-xs">
              <ChevronLeft className="!size-6" aria-hidden />
            </Button>
          )}
          <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
            {questionIndex + 1} / {totalQuestions}
          </span>
        </div>
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
          VIDEO · 60s
        </span>
      </motion.div>

      {/* Question — centre stage */}
      <motion.div
        className="flex-1 min-h-0 flex flex-col items-center justify-center px-l gap-l overflow-y-auto"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {question.hint && (
          <motion.p variants={fadeUp} className="text-s text-muted-foreground text-center">
            {question.hint}
          </motion.p>
        )}
        <motion.h2
          variants={questionFadeUp}
          className="font-editorial text-l sm:text-xl font-medium text-center text-foreground"
        >
          {question.text}
        </motion.h2>

        <AnimatePresence mode="wait">
          {previewUrl ? (
            <motion.div key="preview" variants={popup} exit="exit" className="w-full max-w-xs">
              <div className="rounded-m overflow-hidden bg-card">
                <video
                  src={previewUrl}
                  controls
                  playsInline
                  muted
                  className="w-full h-auto block"
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-xs">
                {(durationMs / 1000).toFixed(1)}s
              </p>
            </motion.div>
          ) : (
            <motion.div key="capture" variants={fadeUp}>
              {/* Shutter button: structural h-32/w-32 keep the circle; the lg padding still fits the icon. */}
              <Button
                size="lg"
                className="h-32 w-32"
                onClick={triggerCamera}
                disabled={validating}
                aria-label="Record a video"
              >
                <Video className="!size-14" aria-hidden />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {validating && (
          <p className="text-xs text-muted-foreground">Checking video…</p>
        )}
        {error && (
          <p className="text-xs text-error text-center max-w-xs">{error}</p>
        )}
      </motion.div>

      {/* Bottom section */}
      <motion.div
        className="flex flex-col items-center gap-s px-l pb-safe flex-shrink-0"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {previewUrl ? (
          <div className="flex items-center gap-s w-full max-w-sm">
            <Button type="button" size="lg" variant="secondary" className="flex-1" onClick={handleRetake}>
              Retake
            </Button>
            <Button type="button" size="lg" className="flex-1" onClick={handleConfirm}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center max-w-xs pb-xs">
            Tap to record. Keep it short and hold your phone upright.
          </p>
        )}
      </motion.div>
    </div>
  );
}

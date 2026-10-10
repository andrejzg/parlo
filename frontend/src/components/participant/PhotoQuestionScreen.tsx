import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, ChevronLeft } from "lucide-react";
import imageCompression from "browser-image-compression";
import { SurveyQuestion, VoiceAnswer } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/posthog";
import { stagger, fadeUp, questionFadeUp, popup, transitionLarge } from "@/lib/animations";

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
          PHOTO
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

        {/* Photo preview or capture button */}
        <AnimatePresence mode="wait">
          {previewUrl ? (
            <motion.div key="preview" variants={popup} exit="exit" className="w-full max-w-sm">
              <div className="rounded-m overflow-hidden bg-card">
                <img
                  src={previewUrl}
                  alt="Your answer"
                  className="w-full h-auto block"
                />
              </div>
            </motion.div>
          ) : (
            <motion.div key="capture" variants={fadeUp}>
              {/* Shutter button: structural h-32/w-32 keep the circle; the lg padding still fits the icon. */}
              <Button
                size="lg"
                className="h-32 w-32"
                onClick={triggerCamera}
                disabled={isCompressing}
                aria-label="Take a photo"
              >
                <Camera className="!size-14" aria-hidden />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {isCompressing && (
          <p className="text-xs text-muted-foreground">Processing photo…</p>
        )}
        {error && (
          <p className="text-xs text-error">{error}</p>
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
            Tap the camera to take a photo. You can retake before continuing.
          </p>
        )}
      </motion.div>
    </div>
  );
}

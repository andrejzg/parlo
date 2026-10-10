import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlignLeft, Camera, ChevronRight, Pause, Play, Video } from "lucide-react";
import { VoiceAnswer } from "@/types/survey";
import { useUploadProgress } from "@/lib/useUploadProgress";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stagger, fadeUp, press, transitionSmall, transitionLarge } from "@/lib/animations";

interface ReviewScreenProps {
  answers: VoiceAnswer[];
  questions: { id: string; text: string }[];
  onContinue: () => void;
  onRedo: (questionIndex: number) => void;
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface AnswerRowProps {
  answer: VoiceAnswer;
  question?: { id: string; text: string };
  isExpanded: boolean;
  onTap: () => void;
  onRedo: () => void;
}

function AnswerRow({ answer, question, isExpanded, onTap, onRedo }: AnswerRowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);

  // Detect answer media type from the blob's MIME (cleanest signal —
  // photo blobs are image/jpeg, video blobs are video/mp4 or video/quicktime,
  // voice blobs are audio/webm).
  const mime = answer.blob?.type ?? "";
  const isPhoto = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isText = !!answer.textContent;
  const isAudio = !isPhoto && !isVideo && !isText && !!answer.url;
  const canPlay = isAudio;

  // Live upload progress — only surfaced for video answers (voice/photo
  // uploads are tiny and finish before the user scrolls to Review). Returns
  // undefined when not uploading, a number 0-100 while uploading.
  const uploadPct = useUploadProgress(answer.questionId);
  const showUploadProgress = isVideo && uploadPct !== undefined;

  useEffect(() => {
    if (isExpanded && canPlay && !playing) {
      const audio = audioRef.current;
      if (!audio) return;
      const tryPlay = () => {
        audio.currentTime = 0;
        audio.play().then(() => setPlaying(true)).catch(() => {});
      };
      if (audio.readyState >= 2) {
        tryPlay();
      } else {
        audio.addEventListener("canplay", tryPlay, { once: true });
        audio.load();
        return () => audio.removeEventListener("canplay", tryPlay);
      }
    }
    if (!isExpanded && playing) {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setPlaying(false);
      setProgress(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      if (audioRef.current && audioRef.current.duration) {
        setProgress(audioRef.current.currentTime / audioRef.current.duration);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const handleEnded = () => {
    setPlaying(false);
    setProgress(0);
  };

  const handleIconTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    // For non-audio answers (text, photo, video) the icon just toggles expand.
    if (!isAudio) {
      onTap();
      return;
    }
    if (isExpanded && playing) {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setPlaying(false);
      setProgress(0);
      onTap();
    } else if (isExpanded && !playing) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().then(() => setPlaying(true)).catch(() => {});
      }
    } else {
      onTap();
    }
  };

  const iconLabel = isAudio
    ? isExpanded && playing
      ? "Stop"
      : "Play"
    : isExpanded
    ? "Collapse"
    : "Expand";

  return (
    <div className="rounded-s overflow-hidden">
      <div className="w-full flex items-center gap-s px-m py-s text-left">
        <motion.button
          type="button"
          onClick={handleIconTap}
          className={cn(
            "shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
            isExpanded ? "bg-color-1-transparent text-color-1" : "bg-muted text-muted-foreground",
          )}
          whileTap={press}
          aria-label={iconLabel}
        >
          {isText ? (
            <AlignLeft size={16} aria-hidden />
          ) : isPhoto ? (
            <Camera size={16} aria-hidden />
          ) : isVideo ? (
            <Video size={16} aria-hidden />
          ) : isExpanded && playing ? (
            <Pause size={14} fill="currentColor" aria-hidden />
          ) : (
            <Play size={14} fill="currentColor" aria-hidden />
          )}
        </motion.button>

        <motion.button
          type="button"
          onClick={onTap}
          className="flex-1 min-w-0 flex items-center gap-xs text-left"
          whileTap={press}
        >
          <div className="flex-1 min-w-0">
            <p className="text-s font-medium text-foreground line-clamp-1">
              {question?.text}
            </p>
            <p className="text-xs text-muted-foreground mt-xxs">
              {isText
                ? "Text response"
                : isPhoto
                ? "Photo"
                : isVideo
                ? showUploadProgress
                  ? `Video · Uploading ${Math.round(uploadPct!)}%`
                  : `Video · ${formatDuration(answer.durationMs)}`
                : formatDuration(answer.durationMs)}
            </p>
          </div>
          <motion.span
            className="shrink-0 flex text-neutral-6"
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={transitionSmall}
            aria-hidden
          >
            <ChevronRight size={16} aria-hidden />
          </motion.span>
        </motion.button>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transitionLarge}
            className="overflow-hidden"
          >
            <div className="px-m pb-m pt-xxs flex flex-col gap-s">
              <p className="text-s text-neutral-8">
                {question?.text}
              </p>

              {isText ? (
                <div className="rounded-s bg-muted px-m py-s text-s text-neutral-8">
                  {answer.textContent}
                </div>
              ) : isPhoto && answer.url ? (
                <div className="rounded-s overflow-hidden bg-background">
                  <img
                    src={answer.url}
                    alt={question?.text ?? "Your photo answer"}
                    className="w-full h-auto block"
                  />
                </div>
              ) : isVideo && answer.url ? (
                <div className="flex flex-col gap-xs">
                  <div className="rounded-s overflow-hidden bg-background">
                    <video
                      src={answer.url}
                      controls
                      playsInline
                      className="w-full h-auto block"
                    />
                  </div>
                  {showUploadProgress ? (
                    <div className="flex flex-col gap-xxs">
                      <div className="w-full h-xxs rounded-full overflow-hidden bg-muted">
                        <motion.div
                          className="h-full rounded-full bg-color-1"
                          animate={{ width: `${uploadPct}%` }}
                          transition={transitionSmall}
                        />
                      </div>
                      <div className="flex justify-between items-center text-xs text-muted-foreground">
                        <span>Uploading video…</span>
                        <span className="font-data tabular-nums">
                          {Math.round(uploadPct!)}%
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end">
                      <span className="font-data text-xs tabular-nums text-muted-foreground">
                        {formatDuration(answer.durationMs)}
                      </span>
                    </div>
                  )}
                </div>
              ) : canPlay ? (
                <div className="flex flex-col gap-xs">
                  <div className="w-full h-xxs rounded-full overflow-hidden bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-color-1"
                      animate={{ width: `${progress * 100}%` }}
                      transition={transitionSmall}
                    />
                  </div>
                  <div className="flex justify-end">
                    <span className="font-data text-xs tabular-nums text-muted-foreground">
                      {formatDuration(answer.durationMs)}
                    </span>
                  </div>
                </div>
              ) : null}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={(e) => { e.stopPropagation(); onRedo(); }}
              >
                Redo this answer
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isAudio && answer.url && (
        <audio ref={audioRef} src={answer.url} onEnded={handleEnded} preload="auto" />
      )}
    </div>
  );
}

export default function ReviewScreen({ answers, questions, onContinue, onRedo }: ReviewScreenProps) {
  const totalMs = answers.reduce((acc, a) => acc + a.durationMs, 0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-l pt-l pb-safe sm:py-xxl"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Brand mark */}
      <motion.div variants={fadeUp} className="flex items-center">
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
          Parlo
        </span>
      </motion.div>

      {/* Main content — scrollable. `min-h-0` is critical: flex items default
          to min-height:auto, which prevents this child from shrinking below
          its content size. Without it, an expanded photo/video answer grows
          the middle section past the viewport and the overflow-y-auto never
          kicks in — the content gets clipped behind the CTA instead. */}
      <div className="flex flex-col items-center gap-l max-w-sm mx-auto w-full overflow-y-auto flex-1 min-h-0 py-m">
        <motion.div variants={fadeUp} className="flex flex-col gap-xs text-center">
          <h1 className="font-brand text-l sm:text-xl font-heavy text-foreground">
            Review your answers
          </h1>
          <p className="text-s text-muted-foreground">
            Tap to listen back, redo any you're not happy with
          </p>
        </motion.div>

        {/* Answers card */}
        <motion.div
          variants={fadeUp}
          className="w-full rounded-m bg-card overflow-hidden text-left"
        >
          <div className="flex items-center justify-between px-l pt-m pb-xs">
            <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
              Your responses
            </p>
            <span className="font-data text-xs tabular-nums text-muted-foreground">
              {formatDuration(totalMs)} total
            </span>
          </div>

          <div className="px-xs pb-xs">
            {answers.map((answer, idx) => {
              const q = questions.find((q) => q.id === answer.questionId);
              return (
                <AnswerRow
                  key={answer.questionId}
                  answer={answer}
                  question={q}
                  isExpanded={expandedId === answer.questionId}
                  onTap={() => setExpandedId(expandedId === answer.questionId ? null : answer.questionId)}
                  onRedo={() => onRedo(idx)}
                />
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Continue button */}
      <motion.div variants={fadeUp} className="w-full max-w-sm shrink-0">
        <Button size="lg" className="w-full" onClick={onContinue}>
          Looks good, continue
        </Button>
      </motion.div>
    </motion.div>
  );
}

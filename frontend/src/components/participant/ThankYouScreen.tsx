import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlignLeft, Camera, Check, ChevronRight, Pause, Play, Video } from "lucide-react";
import { VoiceAnswer } from "@/types/survey";
import { trackEvent } from "@/lib/posthog";
import { buildShareUrl } from "@/lib/slug";
import { buildBotChatUrl } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stagger, fadeUp, press, popup, transitionSmall, transitionLarge } from "@/lib/animations";

interface ThankYouScreenProps {
  answers: VoiceAnswer[];
  questions: { id: string; text: string }[];
  surveyCode: string;
  surveyTitle?: string | null;
  responseCode?: string;
  onRedo?: (questionIndex: number) => void;
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
  onRedo?: () => void;
}

function AnswerRow({ answer, question, isExpanded, onTap, onRedo }: AnswerRowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);

  // Detect answer media type from the blob's MIME.
  const mime = answer.blob?.type ?? "";
  const isPhoto = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isText = !!answer.textContent;
  const isAudio = !isPhoto && !isVideo && !isText && !!answer.url;
  const canPlay = isAudio;

  // Auto-play when expanding, stop when collapsing
  useEffect(() => {
    if (isExpanded && canPlay && !playing) {
      const audio = audioRef.current;
      if (!audio) return;
      // Audio may not be ready yet — wait for canplay if needed
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

  // Track playback progress
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
    if (!isAudio) {
      onTap(); // non-audio answers: just toggle expand
      return;
    }
    if (isExpanded && playing) {
      // Playing → pause and collapse
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      setPlaying(false);
      setProgress(0);
      onTap(); // collapse
    } else if (isExpanded && !playing) {
      // Expanded but paused → replay
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
        setPlaying(true);
      }
    } else {
      // Collapsed → expand (auto-play fires via useEffect)
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
      {/* Compact row — always visible */}
      <div className="w-full flex items-center gap-s px-m py-s text-left">
        {/* Icon — separate tap target */}
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

        {/* Question text + duration + chevron — tapping this toggles expand */}
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
                ? `Video · ${formatDuration(answer.durationMs)}`
                : formatDuration(answer.durationMs)}
            </p>
          </div>

          {/* Chevron rotates when expanded */}
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

      {/* Expanded content */}
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
              {/* Full question text */}
              <p className="text-s text-neutral-8">
                {question?.text}
              </p>

              {/* Answer preview — photo / video / audio / text */}
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
                  <div className="flex justify-end">
                    <span className="font-data text-xs tabular-nums text-muted-foreground">
                      {formatDuration(answer.durationMs)}
                    </span>
                  </div>
                </div>
              ) : canPlay ? (
                <div className="flex flex-col gap-xs">
                  {/* Progress bar */}
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

              {/* Redo button */}
              {onRedo && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    trackEvent("participant_redo_answer_clicked", { questionId: answer.questionId });
                    onRedo();
                  }}
                >
                  Redo this answer
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isAudio && answer.url && (
        <audio
          ref={audioRef}
          src={answer.url}
          onEnded={handleEnded}
          preload="auto"
        />
      )}
    </div>
  );
}

export default function ThankYouScreen({ answers, questions, surveyCode, surveyTitle, responseCode, onRedo }: ThankYouScreenProps) {
  const totalMs = answers.reduce((acc, a) => acc + a.durationMs, 0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const shareUrl = buildShareUrl(surveyTitle, surveyCode);
  const shareText = `Check out this parlo: ${shareUrl}`;
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const whatsappUpdatesUrl = responseCode
    ? buildBotChatUrl(`response ${responseCode}`)
    : undefined;

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-l pt-l pb-safe sm:py-xxl text-center"
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

      {/* Main content — scrollable */}
      {/* `min-h-0` is required — flex items default to min-height:auto which
          blocks shrink, so expanded photo/video previews push content past
          the viewport instead of scrolling. */}
      <div className="flex flex-col items-center gap-l max-w-sm mx-auto w-full overflow-y-auto flex-1 min-h-0 py-m">
        {/* Check mark */}
        <motion.div
          variants={fadeUp}
          className="relative flex items-center justify-center shrink-0"
        >
          <div className="w-16 h-16 rounded-full bg-success-transparent flex items-center justify-center">
            <div className="w-11 h-11 rounded-full bg-success-transparent text-success flex items-center justify-center">
              <motion.span
                className="flex"
                initial={popup.initial}
                animate={popup.animate}
                aria-hidden
              >
                <Check size={22} aria-hidden />
              </motion.span>
            </div>
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="flex flex-col gap-xs">
          <h1 className="font-brand text-l sm:text-xl font-heavy text-foreground">
            All done!
          </h1>
          <p className="text-s text-muted-foreground">
            Tap any answer to review or redo it
          </p>
        </motion.div>

        {/* Your responses card */}
        <motion.div
          variants={fadeUp}
          className="w-full rounded-m bg-card overflow-hidden text-left"
        >
          {/* Card header */}
          <div className="flex items-center justify-between px-l pt-m pb-xs">
            <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
              Your responses
            </p>
            <span className="font-data text-xs tabular-nums text-muted-foreground">
              {formatDuration(totalMs)} total
            </span>
          </div>

          {/* Answer rows */}
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
                  onRedo={onRedo ? () => onRedo(idx) : undefined}
                />
              );
            })}
          </div>
        </motion.div>

        {/* CTAs */}
        <motion.div variants={fadeUp} className="w-full flex flex-col items-center gap-s">
          <Button size="lg" className="w-full" asChild>
            <a
              href={whatsappShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("participant_share_survey_clicked", { surveyCode })}
            >
              Share this parlo
            </a>
          </Button>

          {whatsappUpdatesUrl && (
            <Button variant="link" size="sm" asChild>
              <a
                href={whatsappUpdatesUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent("participant_whatsapp_updates_clicked", { surveyCode, responseCode })}
              >
                Get updates on WhatsApp
              </a>
            </Button>
          )}
        </motion.div>
      </div>

      {/* Footer */}
      <motion.p variants={fadeUp} className="text-xs text-muted-foreground shrink-0">
        Powered by{" "}
        <span className="font-brand font-medium text-neutral-8">Parlo</span>
      </motion.p>
    </motion.div>
  );
}

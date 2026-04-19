import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { VoiceAnswer } from "@/types/survey";
import { trackEvent } from "@/lib/posthog";
import { buildShareUrl } from "@/lib/slug";

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

const stagger = {
  animate: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

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

  return (
    <div className="rounded-xl overflow-hidden">
      {/* Compact row — always visible */}
      <div
        className="w-full flex items-center gap-3 px-3 py-3 text-left transition-colors"
        style={{
          background: isExpanded ? "hsl(225 15% 10%)" : "transparent",
        }}
      >
        {/* Icon — separate tap target */}
        <motion.button
          type="button"
          onClick={handleIconTap}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{
            background: isExpanded ? "hsl(22 95% 62% / 0.15)" : "hsl(225 15% 14%)",
          }}
          whileTap={{ scale: 0.9 }}
        >
          {isText ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isExpanded ? "hsl(22, 95%, 62%)" : "hsl(225 10% 50%)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M4 12h10M4 17h12" />
            </svg>
          ) : isPhoto ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isExpanded ? "hsl(22, 95%, 62%)" : "hsl(225 10% 50%)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          ) : isVideo ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isExpanded ? "hsl(22, 95%, 62%)" : "hsl(225 10% 50%)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          ) : isExpanded && playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="hsl(22, 95%, 62%)" stroke="none">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isExpanded ? "hsl(22, 95%, 62%)" : "hsl(225 10% 50%)"} stroke="none">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </motion.button>

        {/* Question text + duration + chevron — tapping this toggles expand */}
        <motion.button
          type="button"
          onClick={onTap}
          className="flex-1 min-w-0 flex items-center gap-2 text-left"
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex-1 min-w-0">
            <p className={`text-sm line-clamp-1 ${isExpanded ? "text-foreground" : "text-foreground/80"}`}>
              {question?.text}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
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
          <motion.svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="hsl(225 10% 35%)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <polyline points="9 18 15 12 9 6" />
          </motion.svg>
        </motion.button>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
            style={{ background: "hsl(225 15% 10%)" }}
          >
            <div className="px-4 pb-4 pt-1 space-y-3">
              {/* Full question text */}
              <p className="text-sm text-foreground/70 leading-relaxed">
                {question?.text}
              </p>

              {/* Answer preview — photo / video / audio / text */}
              {isText ? (
                <div
                  className="rounded-xl px-4 py-3 text-sm text-foreground/80 leading-relaxed"
                  style={{ background: "hsl(225 15% 14%)" }}
                >
                  {answer.textContent}
                </div>
              ) : isPhoto && answer.url ? (
                <div className="rounded-xl overflow-hidden border border-border" style={{ background: "hsl(225 25% 4%)" }}>
                  <img
                    src={answer.url}
                    alt={question?.text ?? "Your photo answer"}
                    className="w-full h-auto block"
                  />
                </div>
              ) : isVideo && answer.url ? (
                <div className="space-y-2">
                  <div className="rounded-xl overflow-hidden border border-border" style={{ background: "hsl(225 25% 4%)" }}>
                    <video
                      src={answer.url}
                      controls
                      playsInline
                      className="w-full h-auto block"
                    />
                  </div>
                  <div className="flex justify-end">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(answer.durationMs)}
                    </span>
                  </div>
                </div>
              ) : canPlay ? (
                <div className="space-y-2">
                  {/* Progress bar */}
                  <div
                    className="w-full h-1 rounded-full overflow-hidden"
                    style={{ background: "hsl(225 15% 18%)" }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: "hsl(22, 95%, 62%)" }}
                      animate={{ width: `${progress * 100}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <div className="flex justify-end">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(answer.durationMs)}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Redo button */}
              {onRedo && (
                <motion.button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    trackEvent("participant_redo_answer_clicked", { questionId: answer.questionId });
                    onRedo();
                  }}
                  className="w-full py-3 rounded-xl text-sm font-display transition-colors"
                  style={{
                    fontWeight: 600,
                    background: "hsl(225 15% 14%)",
                    color: "hsl(225 10% 65%)",
                    border: "1px solid hsl(225 15% 20%)",
                  }}
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ borderColor: "hsl(225 15% 28%)", color: "hsl(225 10% 80%)" }}
                >
                  Redo this answer
                </motion.button>
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
  const shareText = `Check out this voice survey: ${shareUrl}`;
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const whatsappUpdatesUrl = responseCode
    ? `https://wa.me/12058311222?text=${encodeURIComponent(`response ${responseCode}`)}`
    : undefined;

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-6 pt-6 pb-safe sm:py-12 text-center"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Brand mark */}
      <motion.div variants={fadeUp} className="flex items-center gap-2 opacity-50">
        <div className="w-2 h-2 rounded-full bg-primary" />
        <span className="text-xs font-display tracking-widest uppercase text-muted-foreground">
          Parlo
        </span>
      </motion.div>

      {/* Main content — scrollable */}
      {/* `min-h-0` is required — flex items default to min-height:auto which
          blocks shrink, so expanded photo/video previews push content past
          the viewport instead of scrolling. */}
      <div className="flex flex-col items-center gap-5 max-w-sm mx-auto w-full overflow-y-auto flex-1 min-h-0 py-4">
        {/* Check mark */}
        <motion.div
          variants={fadeUp}
          className="relative flex items-center justify-center shrink-0"
        >
          <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center">
            <div className="w-11 h-11 rounded-full bg-primary/25 flex items-center justify-center">
              <motion.svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="hsl(22, 95%, 62%)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <motion.polyline points="20 6 9 17 4 12" />
              </motion.svg>
            </div>
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="space-y-2">
          <h1 className="font-display text-xl sm:text-3xl leading-tight text-foreground" style={{ fontWeight: 800 }}>
            All done!
          </h1>
          <p className="text-secondary-foreground/70 text-sm leading-relaxed font-light">
            Tap any answer to review or redo it
          </p>
        </motion.div>

        {/* Your responses card */}
        <motion.div
          variants={fadeUp}
          className="w-full bg-card rounded-2xl border border-border overflow-hidden text-left"
        >
          {/* Card header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <p className="font-display text-xs text-muted-foreground tracking-widest uppercase">
              Your responses
            </p>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDuration(totalMs)} total
            </span>
          </div>

          {/* Answer rows */}
          <div className="px-2 pb-2">
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
        <motion.div variants={fadeUp} className="w-full flex flex-col items-center gap-3">
          <motion.a
            href={whatsappShareUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("participant_share_survey_clicked", { surveyCode })}
            className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-display text-base tracking-wide text-center glow-primary"
            style={{ fontWeight: 700, display: "block" }}
            whileTap={{ scale: 0.96, transition: { duration: 0.08 } }}
            whileHover={{ filter: "brightness(1.12)", transition: { duration: 0.15 } }}
          >
            Share this survey
          </motion.a>

          {whatsappUpdatesUrl && (
            <motion.a
              href={whatsappUpdatesUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("participant_whatsapp_updates_clicked", { surveyCode, responseCode })}
              className="text-sm text-muted-foreground hover:text-foreground/70 transition-colors font-display"
              whileTap={{ scale: 0.97 }}
            >
              Get updates on WhatsApp
            </motion.a>
          )}
        </motion.div>
      </div>

      {/* Footer */}
      <motion.p variants={fadeUp} className="text-muted-foreground text-xs shrink-0">
        Powered by{" "}
        <span className="text-foreground/50 font-display">Parlo</span>
      </motion.p>
    </motion.div>
  );
}

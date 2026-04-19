import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { VoiceAnswer } from "@/types/survey";
import { useUploadProgress } from "@/lib/useUploadProgress";

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

  return (
    <div className="rounded-xl overflow-hidden">
      <div
        className="w-full flex items-center gap-3 px-3 py-3 text-left transition-colors"
        style={{ background: isExpanded ? "hsl(225 15% 10%)" : "transparent" }}
      >
        <motion.button
          type="button"
          onClick={handleIconTap}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{ background: isExpanded ? "hsl(22 95% 62% / 0.15)" : "hsl(225 15% 14%)" }}
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
                ? showUploadProgress
                  ? `Video · Uploading ${Math.round(uploadPct!)}%`
                  : `Video · ${formatDuration(answer.durationMs)}`
                : formatDuration(answer.durationMs)}
            </p>
          </div>
          <motion.svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="hsl(225 10% 35%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0"
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <polyline points="9 18 15 12 9 6" />
          </motion.svg>
        </motion.button>
      </div>

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
              <p className="text-sm text-foreground/70 leading-relaxed">
                {question?.text}
              </p>

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
                  {showUploadProgress ? (
                    <div className="space-y-1">
                      <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "hsl(225 15% 18%)" }}>
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: "hsl(22, 95%, 62%)" }}
                          animate={{ width: `${uploadPct}%` }}
                          transition={{ duration: 0.2 }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">Uploading video…</span>
                        <span className="text-muted-foreground tabular-nums">
                          {Math.round(uploadPct!)}%
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDuration(answer.durationMs)}
                      </span>
                    </div>
                  )}
                </div>
              ) : canPlay ? (
                <div className="space-y-2">
                  <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "hsl(225 15% 18%)" }}>
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

              <motion.button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRedo(); }}
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
      className="flex flex-col items-center justify-between h-full px-6 pt-6 pb-safe sm:py-12"
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

      {/* Main content — scrollable. `min-h-0` is critical: flex items default
          to min-height:auto, which prevents this child from shrinking below
          its content size. Without it, an expanded photo/video answer grows
          the middle section past the viewport and the overflow-y-auto never
          kicks in — the content gets clipped behind the CTA instead. */}
      <div className="flex flex-col items-center gap-5 max-w-sm mx-auto w-full overflow-y-auto flex-1 min-h-0 py-4">
        <motion.div variants={fadeUp} className="space-y-2 text-center">
          <h1 className="font-display text-xl sm:text-3xl leading-tight text-foreground" style={{ fontWeight: 800 }}>
            Review your answers
          </h1>
          <p className="text-secondary-foreground/70 text-sm leading-relaxed font-light">
            Tap to listen back, redo any you're not happy with
          </p>
        </motion.div>

        {/* Answers card */}
        <motion.div
          variants={fadeUp}
          className="w-full bg-card rounded-2xl border border-border overflow-hidden text-left"
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <p className="font-display text-xs text-muted-foreground tracking-widest uppercase">
              Your responses
            </p>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDuration(totalMs)} total
            </span>
          </div>

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
                  onRedo={() => onRedo(idx)}
                />
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Continue button */}
      <motion.div variants={fadeUp} className="w-full max-w-sm shrink-0">
        <motion.button
          onClick={onContinue}
          className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-display text-lg tracking-wide glow-primary"
          style={{ fontWeight: 700 }}
          whileTap={{ scale: 0.96, transition: { duration: 0.08 } }}
          whileHover={{ filter: "brightness(1.12)", transition: { duration: 0.15 } }}
        >
          Looks good, continue
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

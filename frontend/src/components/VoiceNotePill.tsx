import { useRef, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { press, transitionSmall } from "@/lib/animations";

interface VoiceNotePillProps {
  url: string;
  durationMs: number;
  /** Omit to hide the delete button (read-only playback). */
  onDelete?: () => void;
  /** Surface override, e.g. `bg-muted` when the pill sits inside a `bg-card` card. */
  className?: string;
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function VoiceNotePill({ url, durationMs, onDelete, className }: VoiceNotePillProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const audio = new Audio();
    // Load on first play: feeds render many pills, each pointing at a signed URL.
    audio.preload = "none";
    audio.src = url;
    audioRef.current = audio;

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    const handleError = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.pause();
      audio.src = "";
      cancelAnimationFrame(rafRef.current);
    };
  }, [url]);

  const updateProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || isScrubbing) return;
    if (audio.duration && isFinite(audio.duration)) {
      setProgress(audio.currentTime / audio.duration);
      setCurrentTime(audio.currentTime * 1000);
    }
    if (!audio.paused) {
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  }, [isScrubbing]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
    } else {
      audio.play();
      rafRef.current = requestAnimationFrame(updateProgress);
      setIsPlaying(true);
    }
  };

  const scrubTo = (clientX: number) => {
    const bar = progressRef.current;
    const audio = audioRef.current;
    if (!bar || !audio) return;

    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

    if (audio.duration && isFinite(audio.duration)) {
      audio.currentTime = pct * audio.duration;
      setProgress(pct);
      setCurrentTime(pct * audio.duration * 1000);
    }
  };

  const handleScrubStart = (e: React.MouseEvent | React.TouchEvent) => {
    setIsScrubbing(true);
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    scrubTo(clientX);
  };

  const handleScrubMove = (e: React.TouchEvent) => {
    if (!isScrubbing) return;
    scrubTo(e.touches[0].clientX);
  };

  const handleScrubEnd = () => {
    setIsScrubbing(false);
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  };

  // Deterministic waveform bars from url
  const barCount = 28;
  const bars = Array.from({ length: barCount }, (_, i) => {
    const seed = url.charCodeAt(i % url.length) + i * 7;
    return 0.25 + (((seed * 9301 + 49297) % 233280) / 233280) * 0.75;
  });

  const displayTime = isPlaying || progress > 0
    ? formatDuration(currentTime)
    : formatDuration(durationMs);

  return (
    <motion.div
      className={cn("w-full flex items-center gap-s rounded-m bg-card px-m py-s", className)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitionSmall}
    >
      {/* Play/Pause — 44px touch target */}
      <motion.button
        type="button"
        onClick={togglePlay}
        className="shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-secondary text-secondary-foreground transition-colors hover:bg-neutral-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
        whileTap={press}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause size={18} fill="currentColor" aria-hidden />
        ) : (
          <Play size={18} fill="currentColor" className="ml-px" aria-hidden />
        )}
      </motion.button>

      {/* Waveform — scrubable with touch drag */}
      <div
        ref={progressRef}
        className="flex-1 flex items-center gap-[2px] h-11 cursor-pointer touch-none"
        onMouseDown={handleScrubStart}
        onTouchStart={handleScrubStart}
        onTouchMove={handleScrubMove}
        onTouchEnd={handleScrubEnd}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        {bars.map((h, i) => {
          const barProgress = (i + 0.5) / barCount;
          const isPast = barProgress <= progress;
          return (
            <div
              key={i}
              className={`flex-1 rounded-full transition-colors ${isPast ? "bg-color-1" : "bg-neutral-4"}`}
              style={{ height: `${h * 100}%`, minHeight: 3 }}
            />
          );
        })}
      </div>

      {/* Duration */}
      <span className="shrink-0 min-w-[2.5rem] text-right font-data text-xs tabular-nums text-muted-foreground">
        {displayTime}
      </span>

      {/* Delete — 44px touch target */}
      {onDelete && (
        <motion.button
          type="button"
          onClick={onDelete}
          className="shrink-0 flex items-center justify-center w-11 h-11 -mr-xxs rounded-full text-muted-foreground transition-colors hover:bg-error-transparent hover:text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
          whileTap={press}
          aria-label="Delete recording"
        >
          <Trash2 size={16} aria-hidden />
        </motion.button>
      )}
    </motion.div>
  );
}

import { useRef, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";

interface VoiceNotePillProps {
  url: string;
  durationMs: number;
  onDelete: () => void;
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function VoiceNotePill({ url, durationMs, onDelete }: VoiceNotePillProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const audio = new Audio(url);
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
      className="w-full flex items-center gap-3 rounded-2xl px-4 py-4"
      style={{ background: "hsl(225 15% 11%)", border: "1px solid hsl(225 15% 18%)" }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Play/Pause — 44px touch target */}
      <motion.button
        type="button"
        onClick={togglePlay}
        className="shrink-0 flex items-center justify-center w-11 h-11 rounded-full transition-colors"
        style={{ background: isPlaying ? "hsl(var(--primary) / 0.2)" : "hsl(var(--primary) / 0.12)" }}
        whileTap={{ scale: 0.9 }}
        whileHover={{ background: "hsl(var(--primary) / 0.25)" }}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="hsl(var(--primary))" stroke="none">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="hsl(var(--primary))" stroke="none" style={{ marginLeft: 2 }}>
            <path d="M8 5v14l11-7z" />
          </svg>
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
              className="flex-1 rounded-full"
              style={{
                height: `${h * 100}%`,
                minHeight: 3,
                background: isPast
                  ? "hsl(var(--primary) / 0.85)"
                  : "hsl(225 15% 20%)",
                transition: "background-color 80ms ease",
              }}
            />
          );
        })}
      </div>

      {/* Duration */}
      <span
        className="shrink-0 text-xs font-medium tabular-nums"
        style={{ color: "hsl(225 10% 50%)", minWidth: "2.5rem", textAlign: "right" }}
      >
        {displayTime}
      </span>

      {/* Delete — 44px touch target */}
      <motion.button
        type="button"
        onClick={onDelete}
        className="shrink-0 flex items-center justify-center w-11 h-11 -mr-1 rounded-full hover:bg-destructive/10 transition-colors"
        whileTap={{ scale: 0.85 }}
        aria-label="Delete recording"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 38%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </motion.button>
    </motion.div>
  );
}

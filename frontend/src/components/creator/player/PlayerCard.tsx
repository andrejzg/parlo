import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface PlayerCardProps {
  questionText: string;
  questionType: "voice" | "photo" | "video";
  audioUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  transcription: string | null;
  transcriptionStatus: string | null;
  durationMs: number;
  isActive: boolean;
  playbackSpeed: number;
  onAudioEnd?: () => void;
  /** Called with 0-1 progress for the active segment progress bar */
  onProgress?: (progress: number) => void;
  /** Called when photo timer expires */
  onTimerEnd?: () => void;
}

const PHOTO_DURATION_MS = 3000;

function estimateVoiceDurationSeconds(durationMs: number, transcription: string | null): number {
  if (durationMs > 0) {
    return durationMs / 1000;
  }

  const wordCount = transcription?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  if (wordCount > 0) {
    // Roughly 155 words per minute, clamped to keep the estimate usable.
    return Math.min(Math.max(wordCount / 2.6, 3), 90);
  }

  return 12;
}

function WaveformBars({ playing }: { playing: boolean }) {
  const barCount = 5;
  const heights = [14, 22, 18, 24, 16];

  return (
    <div className="flex items-center justify-center gap-[5px]" style={{ height: 48 }}>
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className="rounded-full"
          style={{
            width: 4,
            height: heights[i],
            background: "hsl(22 95% 62%)",
            opacity: playing ? 1 : 0.4,
            animation: playing
              ? `waveform-pulse 1s ease-in-out ${i * 0.15}s infinite alternate`
              : "none",
            transition: "opacity 0.3s ease",
          }}
        />
      ))}
      <style>{`
        @keyframes waveform-pulse {
          0% { transform: scaleY(0.4); }
          100% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

function PlayPauseButton({
  playing,
  onToggle,
}: {
  playing: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-center rounded-full select-none"
      style={{
        width: 56,
        height: 56,
        background: "hsl(22 95% 62%)",
      }}
      aria-label={playing ? "Pause" : "Play"}
    >
      {playing ? (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="4" y="3" width="4" height="14" rx="1" fill="white" />
          <rect x="12" y="3" width="4" height="14" rx="1" fill="white" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M6 3.5L16 10L6 16.5V3.5Z" fill="white" />
        </svg>
      )}
    </button>
  );
}

function VoiceCard({
  questionText,
  audioUrl,
  transcription,
  durationMs,
  isActive,
  playbackSpeed,
  onAudioEnd,
  onProgress,
}: Pick<
  PlayerCardProps,
  | "questionText"
  | "audioUrl"
  | "transcription"
  | "durationMs"
  | "isActive"
  | "playbackSpeed"
  | "onAudioEnd"
  | "onProgress"
>) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const activatedAtRef = useRef<number>(0);
  const lastProgressRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [showTranscription, setShowTranscription] = useState(false);

  useEffect(() => {
    if (!isActive) {
      lastProgressRef.current = 0;
      return;
    }

    activatedAtRef.current = performance.now();
    lastProgressRef.current = 0;
  }, [isActive]);

  // WebM duration metadata may not be readable until the file download completes.
  // Start the loop as soon as the card becomes active and fall back to an estimate
  // so the progress bar can move immediately.
  useEffect(() => {
    if (!isActive || !audioUrl || !audioRef.current) return;

    const estimatedDurationSeconds = estimateVoiceDurationSeconds(durationMs, transcription);

    const tick = () => {
      const el = audioRef.current;
      if (el) {
        const mediaDuration =
          Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
        const elapsedSinceActive = (performance.now() - activatedAtRef.current) / 1000;
        const playbackPosition =
          el.currentTime > 0 ? el.currentTime : !el.paused ? elapsedSinceActive : 0;
        const duration = mediaDuration ?? estimatedDurationSeconds;
        const rawProgress = duration > 0 ? playbackPosition / duration : 0;
        const nextProgress = Math.min(Math.max(lastProgressRef.current, rawProgress), 0.99);

        lastProgressRef.current = nextProgress;
        onProgress?.(nextProgress);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audioUrl, durationMs, isActive, onProgress, transcription]);

  // Auto-play when active, pause when inactive
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isActive && audioUrl) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isActive, audioUrl]);

  // Respect playback speed
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Reset transcription visibility when card becomes inactive
  useEffect(() => {
    if (!isActive) {
      cancelAnimationFrame(rafRef.current);
      setShowTranscription(false);
      onProgress?.(0);
    }
  }, [isActive, onProgress]);

  const handleToggle = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => {});
      setPlaying(true);
    }
  };

  const handleEnded = () => {
    setPlaying(false);
    setShowTranscription(true);
    lastProgressRef.current = 1;
    onProgress?.(1);
    onAudioEnd?.();
  };

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center px-6"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Question text */}
      <p
        className="text-lg text-center font-display mb-12 max-w-sm"
        style={{ color: "hsl(225 10% 50%)" }}
      >
        {questionText}
      </p>

      {/* Waveform */}
      <WaveformBars playing={playing} />

      {/* Play/pause */}
      <div className="mt-6">
        <PlayPauseButton playing={playing} onToggle={handleToggle} />
      </div>

      {/* Transcription (fades in after audio ends) */}
      {transcription && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: showTranscription ? 1 : 0 }}
          transition={{ duration: 0.8 }}
          className="text-sm mt-8 max-w-sm text-center leading-relaxed overflow-y-auto"
          style={{
            color: "hsl(40 20% 88%)",
            maxHeight: "5.5em",
          }}
        >
          {transcription}
        </motion.p>
      )}

      {/* Hidden audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onEnded={handleEnded}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
        />
      )}
    </div>
  );
}

function PhotoCard({
  questionText,
  imageUrl,
  isActive,
  onProgress,
  onTimerEnd,
}: Pick<PlayerCardProps, "questionText" | "imageUrl" | "isActive" | "onProgress" | "onTimerEnd">) {
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    startRef.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      const progress = Math.min(elapsed / PHOTO_DURATION_MS, 1);
      onProgress?.(progress);
      if (progress >= 1) {
        onTimerEnd?.();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isActive, onProgress, onTimerEnd]);

  return (
    <div className="relative w-full h-full" style={{ background: "hsl(225 25% 4%)" }}>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          loading="eager"
        />
      )}

      {/* Gradient overlay for question text */}
      <div
        className="absolute inset-x-0 top-0 z-10 px-6 pt-16 pb-12"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, transparent 100%)",
        }}
      >
        <p
          className="text-lg font-display text-center"
          style={{ color: "hsl(40 20% 95%)" }}
        >
          {questionText}
        </p>
      </div>
    </div>
  );
}

function VideoCard({
  questionText,
  videoUrl,
  isActive,
  playbackSpeed,
  onProgress,
  onTimerEnd,
}: Pick<
  PlayerCardProps,
  "questionText" | "videoUrl" | "isActive" | "playbackSpeed" | "onProgress" | "onTimerEnd"
>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isActive && videoUrl) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isActive, videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Report progress + fire onTimerEnd when video completes
  useEffect(() => {
    const video = videoRef.current;
    if (!isActive || !video) return;
    const tick = () => {
      if (video.duration > 0) {
        const p = video.currentTime / video.duration;
        onProgress?.(p);
        if (p >= 0.99) {
          onTimerEnd?.();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isActive, onProgress, onTimerEnd]);

  return (
    <div className="absolute inset-0" style={{ background: "hsl(225 25% 4%)" }}>
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          controls
          preload="auto"
        />
      )}

      {/* Gradient overlay for question text */}
      <div
        className="absolute inset-x-0 top-0 z-10 px-6 pt-16 pb-12"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, transparent 100%)",
        }}
      >
        <p
          className="text-lg font-display text-center"
          style={{ color: "hsl(40 20% 95%)" }}
        >
          {questionText}
        </p>
      </div>
    </div>
  );
}

export default function PlayerCard(props: PlayerCardProps) {
  const { questionType } = props;

  return (
    <div className="w-full h-full relative">
      {questionType === "voice" && (
        <VoiceCard
          questionText={props.questionText}
          audioUrl={props.audioUrl}
          transcription={props.transcription}
          durationMs={props.durationMs}
          isActive={props.isActive}
          playbackSpeed={props.playbackSpeed}
          onAudioEnd={props.onAudioEnd}
          onProgress={props.onProgress}
        />
      )}
      {questionType === "photo" && (
        <PhotoCard
          questionText={props.questionText}
          imageUrl={props.imageUrl}
          isActive={props.isActive}
          onProgress={props.onProgress}
          onTimerEnd={props.onTimerEnd}
        />
      )}
      {questionType === "video" && (
        <VideoCard
          questionText={props.questionText}
          videoUrl={props.videoUrl}
          isActive={props.isActive}
          playbackSpeed={props.playbackSpeed}
          onProgress={props.onProgress}
          onTimerEnd={props.onTimerEnd}
        />
      )}
    </div>
  );
}

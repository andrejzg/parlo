import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { transitionLarge } from "@/lib/animations";

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

/**
 * Photo/video cards overlay the question on the media. The scrim fades the
 * canvas colour into the picture; `pt-20` is structural — it clears the
 * absolutely positioned top bar (exit button + badge + progress) in
 * ListeningPlayer.
 */
const MEDIA_QUESTION_OVERLAY =
  "absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-neutral-1 via-neutral-1-transparent to-transparent px-l pb-xxl pt-20";

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
    <div className="flex h-12 items-center justify-center gap-xxs">
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-full bg-color-1 transition-opacity${playing ? " waveform-pulse" : ""}`}
          style={{
            // Structural: per-bar height and choreography delay drive the loop.
            height: heights[i],
            opacity: playing ? 1 : 0.4,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
      {/* Status loop (audio is playing) — keeps its own cadence like
          rec-blink / pulse-ring in index.css rather than --motion-duration. */}
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
    <Button
      type="button"
      size="icon"
      onClick={onToggle}
      className="h-14 w-14"
      aria-label={playing ? "Pause" : "Play"}
    >
      {playing ? (
        <Pause className="!size-5" fill="currentColor" aria-hidden />
      ) : (
        <Play className="!size-5 ml-px" fill="currentColor" aria-hidden />
      )}
    </Button>
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
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-background px-l">
      {/* Question text */}
      <p className="mb-xxl max-w-sm text-center font-brand text-m text-muted-foreground">
        {questionText}
      </p>

      {/* Waveform */}
      <WaveformBars playing={playing} />

      {/* Play/pause */}
      <div className="mt-l">
        <PlayPauseButton playing={playing} onToggle={handleToggle} />
      </div>

      {/* Transcription (fades in after audio ends) */}
      {transcription && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: showTranscription ? 1 : 0 }}
          transition={transitionLarge}
          className="mt-xl max-w-sm overflow-y-auto text-center text-m text-neutral-8"
          style={{
            // Structural: clamps the scrollable transcript box to ~3.5 lines.
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
    <div className="relative h-full w-full bg-background">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          loading="eager"
        />
      )}

      {/* Scrim overlay for question text */}
      <div className={MEDIA_QUESTION_OVERLAY}>
        <p className="text-center font-brand text-m text-foreground">
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
    <div className="absolute inset-0 bg-background">
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

      {/* Scrim overlay for question text */}
      <div className={MEDIA_QUESTION_OVERLAY}>
        <p className="text-center font-brand text-m text-foreground">
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

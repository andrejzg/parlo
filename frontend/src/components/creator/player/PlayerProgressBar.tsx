interface PlayerProgressBarProps {
  totalSegments: number;
  activeSegment: number;
  /** 0-1 progress within the active segment (for animated fill) */
  activeProgress?: number;
}

export default function PlayerProgressBar({
  totalSegments,
  activeSegment,
  activeProgress = 0,
}: PlayerProgressBarProps) {
  return (
    <div className="flex w-full gap-xxs">
      {Array.from({ length: totalSegments }).map((_, i) => {
        const isPast = i < activeSegment;
        const isActive = i === activeSegment;
        const isCompleted = isActive && activeProgress >= 0.99;
        const isBuffering = isActive && activeProgress === 0;

        return (
          <div
            key={i}
            className="relative h-xxs flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                isPast || isCompleted ? "bg-neutral-8" : "bg-color-1"
              }${isBuffering ? " progress-pulse" : ""}`}
              style={{
                // Structural: fill width is the playback position.
                width: isPast
                  ? "100%"
                  : isActive
                    ? isBuffering
                      ? "100%"
                      : `${activeProgress * 100}%`
                    : "0%",
              }}
            />
          </div>
        );
      })}
      {/* Status loop (segment is buffering) — keeps its own cadence like
          rec-blink / pulse-ring in index.css rather than --motion-duration. */}
    </div>
  );
}

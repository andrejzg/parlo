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
    <div className="flex gap-1 w-full">
      {Array.from({ length: totalSegments }).map((_, i) => {
        const isPast = i < activeSegment;
        const isActive = i === activeSegment;
        const isCompleted = isActive && activeProgress >= 0.99;
        const isBuffering = isActive && activeProgress === 0;

        return (
          <div
            key={i}
            className="flex-1 rounded-full overflow-hidden relative"
            style={{
              height: 3,
              background: "hsl(225 10% 25%)",
            }}
          >
            <div
              className={`absolute inset-y-0 left-0 rounded-full${isBuffering ? " progress-pulse" : ""}`}
              style={{
                width: isPast
                  ? "100%"
                  : isActive
                    ? isBuffering
                      ? "100%"
                      : `${activeProgress * 100}%`
                    : "0%",
                background: isPast || isCompleted
                  ? "hsl(40 20% 80%)"
                  : "hsl(22 95% 62%)",
                opacity: isBuffering ? undefined : 1,
              }}
            />
          </div>
        );
      })}
      <style>{`
        @keyframes progress-pulse {
          0%, 100% { opacity: 0.15; }
          50% { opacity: 0.4; }
        }
        .progress-pulse {
          animation: progress-pulse 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

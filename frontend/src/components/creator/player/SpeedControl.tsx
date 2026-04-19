interface SpeedControlProps {
  speed: number;
  onToggle: () => void;
}

const SPEED_LABELS: Record<number, string> = {
  1: "1x",
  1.5: "1.5x",
  2: "2x",
};

export default function SpeedControl({ speed, onToggle }: SpeedControlProps) {
  return (
    <button
      onClick={onToggle}
      className="rounded-lg px-2.5 py-1 text-xs font-display font-semibold select-none"
      style={{
        background: "hsl(225 15% 12%)",
        color: "hsl(40 20% 80%)",
      }}
      aria-label={`Playback speed ${SPEED_LABELS[speed] ?? `${speed}x`}`}
    >
      {SPEED_LABELS[speed] ?? `${speed}x`}
    </button>
  );
}

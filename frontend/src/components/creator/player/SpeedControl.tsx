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
  const label = SPEED_LABELS[speed] ?? `${speed}x`;
  // One pill that cycles 1x → 1.5x → 2x. It reads as "selected" whenever
  // playback is sped up, so the accelerated state is visible at a glance.
  const isBoosted = speed !== 1;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`select-none rounded-full px-s py-xxs font-data text-xs font-medium tabular-nums transition-colors active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ${
        isBoosted ? "bg-primary text-primary-foreground" : "bg-muted text-neutral-8 hover:bg-neutral-4"
      }`}
      aria-label={`Playback speed ${label}`}
    >
      {label}
    </button>
  );
}

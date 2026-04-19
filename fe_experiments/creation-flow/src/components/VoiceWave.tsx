import { useEffect, useRef } from "react";

interface VoiceWaveProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
}

const BAR_COUNT = 48;

export default function VoiceWave({ analyser, isRecording }: VoiceWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const barsRef = useRef<number[]>(Array(BAR_COUNT).fill(0.08));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser ? analyser.fftSize : 256);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      if (analyser && isRecording) {
        analyser.getByteTimeDomainData(dataArray);
        // Map frequency data to bars with smoothing
        for (let i = 0; i < BAR_COUNT; i++) {
          const idx = Math.floor((i / BAR_COUNT) * dataArray.length);
          const raw = (dataArray[idx] - 128) / 128;
          const target = Math.max(0.06, Math.abs(raw));
          barsRef.current[i] += (target - barsRef.current[i]) * 0.35;
        }
      } else {
        // Idle: gentle breathing animation
        const t = Date.now() / 1000;
        for (let i = 0; i < BAR_COUNT; i++) {
          const phase = (i / BAR_COUNT) * Math.PI * 2;
          const idle = 0.06 + 0.04 * Math.sin(t * 1.2 + phase);
          barsRef.current[i] += (idle - barsRef.current[i]) * 0.08;
        }
      }

      const barW = (W / BAR_COUNT) * 0.55;
      const gap = (W / BAR_COUNT) * 0.45;
      const maxH = H * 0.85;

      for (let i = 0; i < BAR_COUNT; i++) {
        const barH = Math.max(3, barsRef.current[i] * maxH);
        const x = i * (barW + gap) + gap / 2;
        const y = H / 2 - barH / 2;

        // Color: orange with brightness based on amplitude
        const alpha = isRecording ? 0.5 + barsRef.current[i] * 1.5 : 0.35;
        const clamped = Math.min(1, alpha);
        ctx.fillStyle = `hsla(22, 95%, ${55 + barsRef.current[i] * 20}%, ${clamped})`;

        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, barW / 2);
        ctx.fill();
      }
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, isRecording]);

  // Handle DPR for sharpness
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: "block" }}
    />
  );
}

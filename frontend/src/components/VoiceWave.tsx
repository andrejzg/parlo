import { useEffect, useRef, useState } from "react";

interface VoiceWaveProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
}

const BAR_COUNT = 48;
const TICK_MS = 60;
const HEARTBEAT_INTERVAL_MS = 1000;

/**
 * WhatsApp-style scrolling waveform.
 * New amplitude samples push onto the right, oldest drops off the left.
 * Ported from PlaybookLM's ptt-waveform approach, adapted for Parlo's
 * shared mic stream and orange color palette.
 */
export default function VoiceWave({ analyser, isRecording }: VoiceWaveProps) {
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(0));
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const lastHeartbeatRef = useRef<number>(0);

  useEffect(() => {
    if (!analyser) {
      dataArrayRef.current = null;
      return;
    }
    dataArrayRef.current = new Uint8Array(analyser.fftSize);
  }, [analyser]);

  useEffect(() => {
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);

      const now = performance.now();
      if (now - lastTickRef.current < TICK_MS) return;
      lastTickRef.current = now;

      if (analyser && isRecording && dataArrayRef.current) {
        analyser.getByteTimeDomainData(dataArrayRef.current);
        const data = dataArrayRef.current;

        // RMS amplitude
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Boost + power curve: lifts quiet sounds, compresses loud
        let value = Math.min(1, Math.pow(rms * 6, 0.8));

        // Heartbeat: small bump every ~1s during silence to show it's alive
        if (value < 0.03 && now - lastHeartbeatRef.current >= HEARTBEAT_INTERVAL_MS) {
          lastHeartbeatRef.current = now;
          value = 0.22;
        }

        setBars((prev) => {
          const next = prev.slice(1);
          next.push(value);
          return next;
        });
      } else {
        // Idle breathing
        const t = now / 1000;
        setBars((prev) => {
          const next = prev.slice(1);
          const idle = 0.04 + 0.03 * Math.sin(t * 1.2);
          next.push(idle);
          return next;
        });
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, isRecording]);

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden"
      role="img"
      aria-label="Audio waveform visualization"
    >
      <div className="flex h-full w-full items-center justify-center gap-[3px]">
        {bars.map((v, i) => (
          <div
            key={i}
            className="w-[3px] rounded-full"
            style={{
              height: `${Math.max(4, v * 36)}px`,
              background: `hsla(22, 95%, ${55 + v * 20}%, ${isRecording ? 0.5 + v * 0.4 : 0.3})`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

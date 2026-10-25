import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Loader2, Mic, Square, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import VoiceWave from "@/components/VoiceWave";
import VoiceNotePill from "@/components/VoiceNotePill";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { fadeUp, popup, press, stagger, transitionLarge, transitionSmall } from "@/lib/animations";
import { trackEvent, captureException } from "@/lib/posthog";
import { finalizeRecording } from "@/lib/audioTrim";
import { synthesizeOpener } from "@/api/client";
import { toast } from "@/components/ui/sonner";

/**
 * Second step of creation: the opener, what the group hears before the first
 * question. Three ways in, one screen:
 *   voice (default) — tap to record, 60 s cap, listen back, re-take
 *   type            — write it; "Hear it in my voice" says it in the clone
 *                     made on the previous screen and saves it server-side
 *   video           — the native camera, vertical, 60 s / 25 MB like answers
 * "Skip for now" never blocks the flow. The parent uploads voice and video
 * takes in the background; the typed one is already stored by the synthesis.
 */

export type OpenerMode = "voice" | "text" | "video";

export type OpenerResult =
  | { kind: "voice"; blob: Blob; durationMs: number }
  | { kind: "video"; blob: Blob; durationMs: number }
  | { kind: "text"; text: string; durationMs: number };

interface OpenerScreenProps {
  surveyId: string;
  /** Without a clone the typed opener has no voice to be said in. */
  voiceCloned: boolean;
  onContinue: (opener: OpenerResult | null) => void;
  onBack?: () => void;
}

const MAX_MS = 60_000;
const MAX_TEXT_CHARS = 600;
const VIDEO_MAX_S = 60;
const VIDEO_MAX_BYTES = 25 * 1024 * 1024;

const PROMPTS = ["Who you are", "Why you're asking them", "What you'll do with it"];

const MODES: { id: OpenerMode; label: string }[] = [
  { id: "voice", label: "Voice" },
  { id: "text", label: "Type" },
  { id: "video", label: "Video" },
];

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const recordControlClass =
  "relative flex h-[72px] w-[72px] items-center justify-center rounded-full bg-color-1 text-badge-foreground transition-[background-color,color,box-shadow] hover:shadow-s focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:pointer-events-none disabled:bg-muted disabled:text-neutral-6";

function ModeChip({ selected, onClick, children, value }: { selected: boolean; onClick: () => void; children: React.ReactNode; value: OpenerMode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid="opener-mode"
      data-value={value}
      data-selected={selected}
      className={`rounded-full px-m py-xs text-s font-medium transition-[background-color,color,transform] active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ${
        selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-neutral-4"
      }`}
    >
      {children}
    </button>
  );
}

type VoicePhase = "idle" | "recording" | "recorded";

export default function OpenerScreen({ surveyId, voiceCloned, onContinue, onBack }: OpenerScreenProps) {
  const [mode, setMode] = useState<OpenerMode>("voice");
  const [isTransitioning, setIsTransitioning] = useState(false);

  // ── voice ──
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; durationMs: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const takeUrlRef = useRef<string | null>(null);

  // ── text ──
  const [text, setText] = useState("");
  const [synthesizing, setSynthesizing] = useState(false);
  const [spoken, setSpoken] = useState<{ text: string; url: string; durationMs: number } | null>(null);

  // ── video ──
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [video, setVideo] = useState<{ blob: Blob; url: string; durationMs: number } | null>(null);
  const [validating, setValidating] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopTimer();
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    };
  }, []);

  const finishRecording = useCallback(async () => {
    stopTimer();
    const rec = await recorder.stop();
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    if (rec.blob.size > 0) {
      const finished = await finalizeRecording(rec, "intro");
      if (finished.url !== rec.url) URL.revokeObjectURL(rec.url);
      takeUrlRef.current = finished.url;
      setTake({ blob: finished.blob, url: finished.url, durationMs: finished.durationMs });
      setPhase("recorded");
      trackEvent("opener_recorded", { durationMs: finished.durationMs });
    } else {
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    if (isTransitioning) return;
    setElapsed(0);
    const ok = await recorder.start();
    if (!ok) return;
    setPhase("recording");
    trackEvent("opener_recording_started");
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_MS) void finishRecording();
    }, 100);
  };

  const discardTake = () => {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTake(null);
    setPhase("idle");
    setElapsed(0);
  };

  const switchMode = async (next: OpenerMode) => {
    if (next === mode || isTransitioning) return;
    if (recorder.isRecording) {
      stopTimer();
      await recorder.stop();
      setPhase("idle");
      setElapsed(0);
    }
    trackEvent("opener_mode", { mode: next });
    setMode(next);
  };

  const handleSynthesize = async () => {
    const t = text.trim();
    if (!t || synthesizing || !voiceCloned) return;
    setSynthesizing(true);
    try {
      const res = await synthesizeOpener(surveyId, t);
      setSpoken({ text: t, url: res.audioUrl, durationMs: res.durationMs });
      trackEvent("opener_synthesized", { chars: t.length, durationMs: res.durationMs });
    } catch (err) {
      captureException(err, { location: "OpenerScreen.synthesize" });
      toast.error("Couldn't say that just now. Try again, or record it instead.");
    } finally {
      setSynthesizing(false);
    }
  };

  const triggerCamera = () => fileInputRef.current?.click();

  const handleVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoError(null);
    setValidating(true);
    try {
      if (file.size > VIDEO_MAX_BYTES) {
        throw new Error(`That's ${(file.size / (1024 * 1024)).toFixed(1)}MB. Keep it under 25MB.`);
      }
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      v.src = url;
      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error("Couldn't read the video"));
        setTimeout(() => reject(new Error("Video metadata timeout")), 8000);
      });
      const seconds = v.duration;
      if (!isFinite(seconds) || seconds <= 0) {
        URL.revokeObjectURL(url);
        throw new Error("Couldn't read the video. Try recording again.");
      }
      if (seconds > VIDEO_MAX_S + 1) {
        URL.revokeObjectURL(url);
        throw new Error(`That's ${Math.round(seconds)} seconds. Keep it under a minute.`);
      }
      if (v.videoWidth > v.videoHeight) {
        URL.revokeObjectURL(url);
        throw new Error("Hold your phone upright and record vertically.");
      }
      if (video?.url) URL.revokeObjectURL(video.url);
      setVideo({ blob: file, url, durationMs: Math.round(seconds * 1000) });
      trackEvent("opener_video_captured", { durationMs: Math.round(seconds * 1000), bytes: file.size });
    } catch (err) {
      captureException(err, { location: "OpenerScreen.handleVideoFile" });
      setVideoError(err instanceof Error ? err.message : "Couldn't process the video.");
    } finally {
      setValidating(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const retakeVideo = () => {
    if (video?.url) URL.revokeObjectURL(video.url);
    setVideo(null);
    setVideoError(null);
    setTimeout(() => triggerCamera(), 50);
  };

  const handleUse = () => {
    if (isTransitioning) return;
    if (mode === "voice" && take) {
      setIsTransitioning(true);
      takeUrlRef.current = null; // the parent uploads it; don't revoke
      trackEvent("opener_saved", { kind: "voice" });
      onContinue({ kind: "voice", blob: take.blob, durationMs: take.durationMs });
    } else if (mode === "text" && spoken) {
      setIsTransitioning(true);
      trackEvent("opener_saved", { kind: "text" });
      onContinue({ kind: "text", text: spoken.text, durationMs: spoken.durationMs });
    } else if (mode === "video" && video) {
      setIsTransitioning(true);
      trackEvent("opener_saved", { kind: "video" });
      onContinue({ kind: "video", blob: video.blob, durationMs: video.durationMs });
    }
  };

  const handleSkip = async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    stopTimer();
    if (recorder.isRecording) await recorder.stop();
    trackEvent("opener_skipped", { mode });
    onContinue(null);
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    stopTimer();
    if (recorder.isRecording) await recorder.stop();
    onBack();
  };

  const micDenied = recorder.permissionDenied;
  const remaining = Math.max(0, MAX_MS - elapsed);
  const textDirty = !!spoken && spoken.text !== text.trim();
  const canUse =
    (mode === "voice" && phase === "recorded" && !!take) ||
    (mode === "text" && !!spoken && !textDirty) ||
    (mode === "video" && !!video);

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-background" data-testid="opener">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
        capture="environment"
        onChange={handleVideoFile}
        className="hidden"
      />

      {/* Top bar */}
      <motion.div
        className="flex items-center gap-xs px-l pt-xxl pb-xxs shrink-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        {onBack && (
          <Button type="button" variant="ghost" size="icon" onClick={handleBack} aria-label="Back" className="-ml-xs">
            <ChevronLeft className="!size-6" aria-hidden />
          </Button>
        )}
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
          Step 2 · Your opener
        </span>
        <div className="flex-1" />
        {phase === "recording" && (
          <motion.div
            className="flex items-center gap-xs rounded-full bg-card px-s py-xxs"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={transitionSmall}
          >
            <span className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
            <span className={`font-data text-s font-medium tabular-nums ${remaining <= 10_000 ? "text-error" : "text-color-1"}`}>
              {formatDuration(elapsed)}
            </span>
          </motion.div>
        )}
      </motion.div>

      {/* Heading, prompts, mode */}
      <motion.div className="px-l pt-xxs shrink-0" variants={stagger} initial="initial" animate="animate">
        <motion.h2 variants={fadeUp} className="font-editorial text-l sm:text-xl font-medium text-foreground">
          {mode === "video" ? "Film your opener" : mode === "text" ? "Write your opener" : "Record your opener"}
        </motion.h2>
        <motion.p variants={fadeUp} className="mt-xs text-s text-muted-foreground">
          The group hears this before the first question. Under a minute.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-s flex flex-wrap gap-xs" role="group" aria-label="How to make it">
          {MODES.map((m) => (
            <ModeChip key={m.id} value={m.id} selected={mode === m.id} onClick={() => void switchMode(m.id)}>
              {m.label}
            </ModeChip>
          ))}
        </motion.div>

        {mode !== "text" && (
          <motion.ul className="flex flex-col gap-xs mt-s list-none" aria-label="What to mention">
            {PROMPTS.map((t, i) => (
              <motion.li key={t} variants={fadeUp} className="flex items-center gap-s rounded-s bg-card px-s py-xs">
                <span
                  className="flex h-l w-l shrink-0 items-center justify-center rounded-full bg-muted font-data text-xxs font-medium tabular-nums text-muted-foreground"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="text-s font-medium text-neutral-8">{t}</span>
              </motion.li>
            ))}
          </motion.ul>
        )}

        {mode === "text" && (
          <motion.div variants={fadeUp} className="mt-s flex flex-col gap-xs">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT_CHARS))}
              placeholder="Hey, it's me. I'm asking because… and here's what I'll do with what you say."
              rows={5}
              autoFocus
              aria-label="Your opener"
              data-testid="opener-textarea"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{voiceCloned ? "Said in your voice, from the passage you read." : "Clone your voice first to hear this read out."}</span>
              <span className="font-data tabular-nums">{text.length}/{MAX_TEXT_CHARS}</span>
            </div>
          </motion.div>
        )}
      </motion.div>

      <div className="flex-1 min-h-0" />

      {/* Per-mode controls + CTA */}
      <motion.div className="flex flex-col items-center gap-s px-l pt-xs pb-safe shrink-0" variants={stagger} initial="initial" animate="animate">
        {mode === "voice" && micDenied && (
          <motion.div variants={fadeUp} className="w-full rounded-s bg-card px-m py-xs text-center text-xs text-muted-foreground">
            Mic unavailable. Type it instead, or add an opener later from the dashboard.
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {mode === "voice" && phase === "recorded" && take ? (
            <motion.div key="take" className="w-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: transitionSmall }} transition={transitionSmall} data-testid="opener-take">
              <VoiceNotePill url={take.url} durationMs={take.durationMs} onDelete={discardTake} />
            </motion.div>
          ) : mode === "voice" ? (
            <motion.div key="waveform" className="w-full h-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: transitionSmall }} transition={transitionSmall}>
              <VoiceWave analyser={recorder.analyser} isRecording={recorder.isRecording} />
            </motion.div>
          ) : mode === "text" && spoken && !textDirty ? (
            <motion.div key="spoken" className="w-full" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: transitionSmall }} transition={transitionSmall} data-testid="opener-spoken">
              <VoiceNotePill url={spoken.url} durationMs={spoken.durationMs} />
            </motion.div>
          ) : mode === "video" && video ? (
            <motion.div key="video" variants={popup} initial="initial" animate="animate" exit="exit" className="w-full max-w-xs" data-testid="opener-video-preview">
              <div className="rounded-m overflow-hidden bg-card">
                <video src={video.url} controls playsInline muted className="w-full h-auto block max-h-[40svh]" />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-xs font-data tabular-nums">{(video.durationMs / 1000).toFixed(1)}s</p>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {mode === "video" && videoError && <p className="text-xs text-error text-center max-w-xs">{videoError}</p>}

        <motion.p variants={fadeUp} className="text-xs text-center text-muted-foreground">
          {mode === "voice"
            ? phase === "recording"
              ? "Recording. Tap Stop when you're done"
              : phase === "recorded"
              ? "Listen back, or tap the bin to try again"
              : "Tap to start, we'll stop at a minute"
            : mode === "text"
            ? spoken && !textDirty
              ? "Play it. Edit the words to say it again."
              : "Write it, then hear it in your voice"
            : video
            ? "Watch it back, or retake"
            : validating
            ? "Checking video…"
            : "Tap to open the camera. Hold your phone upright."}
        </motion.p>

        {canUse ? (
          <motion.div variants={fadeUp} className="flex items-center gap-s w-full">
            {mode === "video" && (
              <Button type="button" size="lg" variant="secondary" className="flex-1" onClick={retakeVideo} disabled={isTransitioning}>
                Retake
              </Button>
            )}
            <Button size="lg" className="flex-1" onClick={handleUse} disabled={isTransitioning} data-testid="opener-use">
              Use this opener
            </Button>
          </motion.div>
        ) : mode === "voice" ? (
          <motion.div variants={fadeUp} className="relative flex items-center justify-center">
            {phase === "recording" && (
              <span className="absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_var(--color-1-transparent)] pulse-ring" aria-hidden />
            )}
            {phase === "recording" ? (
              <motion.button type="button" onClick={finishRecording} data-testid="opener-stop" aria-label="Stop" className={recordControlClass} whileTap={press}>
                <Square size={24} fill="currentColor" aria-hidden />
              </motion.button>
            ) : (
              <motion.button type="button" onClick={startRecording} disabled={micDenied || isTransitioning} data-testid="opener-record" aria-label="Record your opener" className={recordControlClass} whileTap={press}>
                <Mic size={28} aria-hidden />
              </motion.button>
            )}
          </motion.div>
        ) : mode === "text" ? (
          <motion.div variants={fadeUp} className="w-full">
            <Button
              size="lg"
              className="w-full"
              onClick={() => void handleSynthesize()}
              disabled={!text.trim() || synthesizing || !voiceCloned || isTransitioning}
              data-testid="opener-synthesize"
              data-busy={synthesizing}
            >
              {synthesizing ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Saying it…
                </>
              ) : (
                "Hear it in my voice"
              )}
            </Button>
          </motion.div>
        ) : (
          <motion.div variants={fadeUp}>
            <Button size="lg" className="h-32 w-32" onClick={triggerCamera} disabled={validating || isTransitioning} aria-label="Film your opener" data-testid="opener-camera">
              <Video className="!size-14" aria-hidden />
            </Button>
          </motion.div>
        )}

        <motion.div variants={fadeUp}>
          <Button type="button" variant="link" size="sm" onClick={handleSkip} disabled={isTransitioning} data-testid="opener-skip">
            Skip for now
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}

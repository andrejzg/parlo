import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import VoiceWave from "@/components/VoiceWave";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useLiveTranscript, type TranscriptSource } from "@/hooks/useLiveTranscript";
import { useBriefChecklist, type BriefChecklistState } from "@/hooks/useBriefChecklist";
import { trackEvent } from "@/lib/posthog";

/**
 * Step 1 of creating an agent: one screen where the creator describes the
 * research agent they want, in their own words, while five checklist items
 * tick green as TypeSafe Jev hears them covered. Single screen, phone-first.
 */

export interface BriefResult {
  transcript: string;
  blob?: Blob;
  durationMs: number;
  mode: "voice" | "text";
  source: TranscriptSource | "text";
}

interface BriefScreenProps {
  surveyId: string;
  onContinue: (result: BriefResult) => void;
  onBack?: () => void;
  initialMode?: "voice" | "text";
  /** Pre-fill (e.g. coming back from a follow-up question). */
  initialTranscript?: string;
  /** Parent is fetching the first follow-up question — show a spinner on the CTA. */
  busy?: boolean;
}

const GREEN = "hsl(150 60% 45%)";
const GREEN_SOFT = "hsl(150 45% 12%)";
const MIN_TICKS_TO_SKIP = 3;

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

const item = {
  initial: { opacity: 0, y: 14 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

function ChecklistRow({ entry, index }: { entry: BriefChecklistState; index: number }) {
  const { satisfied, label, hint } = entry;
  return (
    <motion.li
      variants={item}
      className="flex items-center gap-3 rounded-xl px-3"
      style={{ minHeight: "clamp(34px, 4.6svh, 40px)", border: "1px solid" }}
      animate={{
        background: satisfied ? GREEN_SOFT : "hsl(225 15% 9%)",
        borderColor: satisfied ? "hsl(150 50% 30% / 0.6)" : "hsl(225 15% 15%)",
      }}
      transition={{ duration: 0.35 }}
      data-testid={`brief-item-${entry.id}`}
      data-satisfied={satisfied ? "true" : "false"}
    >
      <span
        className="relative flex items-center justify-center shrink-0 rounded-full"
        style={{
          width: 22,
          height: 22,
          background: satisfied ? GREEN : "transparent",
          border: satisfied ? "none" : "1.5px solid hsl(225 12% 30%)",
          transition: "background 0.3s, border 0.3s",
        }}
        aria-hidden
      >
        <AnimatePresence>
          {satisfied ? (
            <motion.svg
              key="tick"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
            >
              <path d="M2.5 6.2L5 8.6L9.6 3.4" stroke="hsl(225 25% 6%)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </motion.svg>
          ) : (
            <span
              key="num"
              className="text-[10px] font-mono"
              style={{ color: "hsl(225 10% 40%)" }}
            >
              {index + 1}
            </span>
          )}
        </AnimatePresence>
      </span>
      <div className="min-w-0 flex-1 flex items-baseline gap-2">
        <span
          className="text-sm font-medium shrink-0"
          style={{ color: satisfied ? "hsl(40 20% 95%)" : "hsl(40 15% 82%)", transition: "color 0.3s" }}
        >
          {label}
        </span>
        <span
          className="text-xs truncate"
          style={{ color: satisfied ? "hsl(150 40% 55%)" : "hsl(225 10% 42%)", fontWeight: 300 }}
        >
          {satisfied ? "got it" : hint}
        </span>
      </div>
    </motion.li>
  );
}

export default function BriefScreen({
  surveyId,
  onContinue,
  onBack,
  initialMode = "voice",
  initialTranscript = "",
  busy = false,
}: BriefScreenProps) {
  const recorder = useVoiceRecorder();
  const transcript = useLiveTranscript({
    surveyId,
    getAudioBlob: recorder.getRecordedBlob,
    analyser: recorder.analyser,
    live: true,
  });

  const [mode, setMode] = useState<"voice" | "text">(initialMode);
  const [textValue, setTextValue] = useState(initialTranscript);
  const [elapsed, setElapsed] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [micDeniedNotice, setMicDeniedNotice] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mountedAtRef = useRef(Date.now());

  const effectiveText = mode === "voice" ? transcript.text : textValue;
  const checklist = useBriefChecklist(surveyId, effectiveText);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed((e) => e + 100), 100);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const beginVoice = useCallback(async () => {
    const ok = await recorder.start();
    if (!ok) return false;
    setHasStarted(true);
    transcript.start();
    startTimer();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start the mic on mount (voice mode only).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (initialMode === "text") return;
    if (initialTranscript) transcript.seed(initialTranscript);
    void beginVoice();
    return () => stopTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mic denied → fall back to typing.
  useEffect(() => {
    if (recorder.permissionDenied && mode === "voice") {
      setMicDeniedNotice(true);
      void switchToText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.permissionDenied]);

  useEffect(() => {
    if (mode === "text") textareaRef.current?.focus();
  }, [mode]);

  // Analytics: ticks and completion.
  const tickedRef = useRef<Set<string>>(new Set());
  const completedRef = useRef(false);
  useEffect(() => {
    for (const entry of checklist.items) {
      if (entry.satisfied && !tickedRef.current.has(entry.id)) {
        tickedRef.current.add(entry.id);
        trackEvent("brief_item_ticked", { item: entry.id, elapsedMs: Date.now() - mountedAtRef.current, mode });
      }
    }
    if (checklist.complete && !completedRef.current) {
      completedRef.current = true;
      trackEvent("brief_completed", {
        elapsedMs: Date.now() - mountedAtRef.current,
        mode,
        source: mode === "voice" ? transcript.source : "text",
        chars: effectiveText.length,
      });
    }
  }, [checklist.items, checklist.complete, mode, transcript.source, effectiveText.length]);

  const switchToText = async () => {
    stopTimer();
    let heard = transcript.text;
    if (recorder.isRecording) {
      await recorder.stop();
      heard = await transcript.stop();
    }
    setTextValue((prev) => (heard.trim() ? heard : prev));
    setMode("text");
  };

  const switchToVoice = async () => {
    setMicDeniedNotice(false);
    setMode("voice");
    transcript.seed(textValue);
    setElapsed(0);
    await beginVoice();
  };

  const handleContinue = async () => {
    if (isTransitioning || busy) return;
    setIsTransitioning(true);

    if (mode === "text") {
      onContinue({ transcript: textValue.trim(), durationMs: 0, mode: "text", source: "text" });
      return;
    }

    stopTimer();
    const rec = await recorder.stop();
    const text = await transcript.stop();
    onContinue({
      transcript: (text || transcript.text).trim(),
      blob: rec.blob.size > 0 ? rec.blob : undefined,
      durationMs: rec.durationMs,
      mode: "voice",
      source: transcript.source ?? "speech",
    });
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    stopTimer();
    if (recorder.isRecording) {
      await recorder.stop();
      await transcript.stop();
    }
    onBack();
  };

  const hasText = effectiveText.trim().length > 0;
  const canContinue = checklist.complete && hasText && !isTransitioning && !busy;
  const canSkip =
    !checklist.complete && checklist.satisfiedCount >= MIN_TICKS_TO_SKIP && hasText && !isTransitioning && !busy;

  // Show the tail of the transcript so the newest words are always visible.
  const TAIL = 150;
  const tail = effectiveText.length > TAIL ? `…${effectiveText.slice(-TAIL)}` : effectiveText;

  return (
    // Sized to fit a 667px-tall phone without scrolling; on anything shorter
    // (320×568 iPhone SE) the column scrolls rather than clipping the CTA.
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: "hsl(225 25% 4%)" }}>
      {/* Top bar */}
      <motion.div
        className="flex items-center gap-2 px-6 pt-12 pb-1 shrink-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        {onBack && (
          <motion.button
            type="button"
            onClick={handleBack}
            aria-label="Back"
            className="flex items-center justify-center w-11 h-11 -ml-3 rounded-full hover:bg-muted/50 transition-colors"
            whileTap={{ scale: 0.9 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 55%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </motion.button>
        )}
        <span className="text-xs font-display tracking-widest uppercase" style={{ color: "hsl(225 10% 45%)" }}>
          Step 1 · Your brief
        </span>
        <div className="flex-1" />
        {mode === "voice" && recorder.isRecording && (
          <motion.div
            className="flex items-center gap-2 rounded-lg px-3 py-1.5"
            style={{ background: "hsla(225, 20%, 8%, 0.85)" }}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
            <span className="text-sm text-primary font-mono font-medium tabular-nums">{formatDuration(elapsed)}</span>
          </motion.div>
        )}
      </motion.div>

      {/* Heading + checklist */}
      <motion.div className="px-6 pt-1 shrink-0" variants={stagger} initial="initial" animate="animate">
        <motion.h2
          variants={item}
          className="font-serif leading-[1.05] tracking-tight"
          style={{ fontSize: "min(clamp(1.6rem, 4.6svh, 2.4rem), 7.5vw)", fontWeight: 600, color: "hsl(40 20% 95%)" }}
        >
          Describe your research agent
        </motion.h2>
        <motion.p
          variants={item}
          className="text-sm mt-1.5 leading-snug"
          style={{ color: "hsl(225 10% 55%)", fontWeight: 300 }}
        >
          Talk it through like you would to a colleague. I'll tick things off as you go.
        </motion.p>

        <motion.ul className="flex flex-col gap-1.5 mt-3 list-none p-0 m-0" aria-label="What to cover">
          {checklist.items.map((entry, i) => (
            <ChecklistRow key={entry.id} entry={entry} index={i} />
          ))}
        </motion.ul>
      </motion.div>

      {/* Live transcript (voice) — flexible, collapses on short screens */}
      <div className="flex-1 min-h-0 px-6 pt-2 flex flex-col justify-end overflow-hidden">
        {mode === "voice" && (
          <p
            className="text-sm leading-relaxed"
            style={{
              color: "hsl(225 10% 58%)",
              fontWeight: 300,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            aria-live="polite"
            data-testid="brief-transcript"
          >
            {hasText ? (
              <>
                {tail}
                {checklist.evaluating && <span className="inline-block w-1.5 h-1.5 ml-1.5 rounded-full bg-primary rec-blink align-middle" />}
              </>
            ) : transcript.listening ? (
              <span style={{ color: "hsl(225 10% 40%)" }}>Listening…</span>
            ) : null}
          </p>
        )}
      </div>

      {/* Input + CTA */}
      <motion.div
        className="flex flex-col items-center gap-2.5 px-6 pt-2 pb-safe shrink-0"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {micDeniedNotice && mode === "text" && (
          <motion.div
            variants={item}
            className="w-full text-center text-xs rounded-2xl px-4 py-2"
            style={{ color: "hsl(225 10% 55%)", background: "hsl(225 15% 10%)" }}
          >
            Mic unavailable — type your brief instead
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {mode === "voice" ? (
            <motion.div
              key="waveform"
              variants={item}
              className="w-full h-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              <VoiceWave analyser={recorder.analyser} isRecording={recorder.isRecording} />
            </motion.div>
          ) : (
            <motion.div
              key="textarea"
              className="w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              <textarea
                ref={textareaRef}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder="Who you'll talk to, what you want to learn, why, the tone, how long…"
                rows={3}
                data-testid="brief-textarea"
                className="w-full resize-none rounded-2xl px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-1"
                style={{
                  background: "hsl(225 15% 10%)",
                  color: "hsl(40 20% 95%)",
                  border: "1px solid hsl(225 15% 18%)",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status line + mode toggle, on one row to save height */}
        <motion.div variants={item} className="flex items-center justify-center gap-3 text-xs" style={{ color: "hsl(225 10% 45%)" }}>
          {mode === "voice" && (
            <span>
              {!hasStarted ? "Starting microphone…" : recorder.isRecording ? "Recording — speak naturally" : "Preparing…"}
            </span>
          )}
          {mode === "voice" && <span aria-hidden>·</span>}
          <button
            type="button"
            onClick={mode === "voice" ? switchToText : switchToVoice}
            className="underline underline-offset-2 hover:text-foreground/80 transition-colors py-2"
          >
            {mode === "voice" ? "Type instead" : "Switch to voice"}
          </button>
        </motion.div>

        {canSkip && (
          <motion.button
            type="button"
            onClick={handleContinue}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs underline underline-offset-2 py-1"
            style={{ color: "hsl(225 10% 50%)" }}
          >
            Continue without the rest
          </motion.button>
        )}

        <motion.button
          variants={item}
          onClick={handleContinue}
          disabled={!canContinue}
          data-testid="brief-continue"
          className="w-full py-5 rounded-2xl font-display text-lg tracking-wide glow-primary disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontWeight: 700, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          whileTap={canContinue ? { scale: 0.96, transition: { duration: 0.07 } } : {}}
          whileHover={canContinue ? { filter: "brightness(1.12)", transition: { duration: 0.12 } } : {}}
        >
          {busy ? "Thinking…" : checklist.complete ? "Continue" : `Continue · ${checklist.satisfiedCount}/${checklist.items.length}`}
        </motion.button>
      </motion.div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import VoiceWave from "@/components/VoiceWave";
import VoiceNotePill from "@/components/VoiceNotePill";
import TextAnswerPill from "@/components/TextAnswerPill";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SurveyQuestion, VoiceAnswer, VoiceSegment } from "@/types/survey";
import { mergeAudioBlobs } from "@/lib/audioMerge";

interface QuestionScreenProps {
  question: SurveyQuestion;
  questionIndex: number;
  totalQuestions: number;
  isLast: boolean;
  existingAnswer?: VoiceAnswer;
  onNext: (answer: VoiceAnswer) => void;
  onBack?: () => void;
  onDeleteAnswer?: () => void;
}

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
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

const questionItem = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function QuestionScreen({
  question,
  questionIndex,
  totalQuestions,
  isLast,
  existingAnswer,
  onNext,
  onBack,
  onDeleteAnswer,
}: QuestionScreenProps) {
  const { isRecording, analyser, permissionDenied, start, stop } = useVoiceRecorder();
  const [elapsed, setElapsed] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [textValue, setTextValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Segments: existing answer segments or single existing answer wrapped
  const [segments, setSegments] = useState<VoiceSegment[]>(() => {
    if (!existingAnswer) return [];
    if (existingAnswer.segments?.length) return [...existingAnswer.segments];
    if (existingAnswer.blob || existingAnswer.url) {
      return [{ blob: existingAnswer.blob, url: existingAnswer.url, durationMs: existingAnswer.durationMs }];
    }
    return [];
  });

  // Whether we're currently recording an additional segment (vs first-time recording)
  const [isAddingMore, setIsAddingMore] = useState(false);

  // Determine view state
  const hasSegments = segments.length > 0;
  const showSegments = hasSegments && !isAddingMore && mode === "voice";
  const isFirstRecording = !hasSegments && !existingAnswer?.textContent && mode === "voice" && !isAddingMore;

  // If revisiting with an existing text answer
  useEffect(() => {
    if (existingAnswer?.textContent) {
      setMode("text");
      setTextValue(existingAnswer.textContent);
    }
  }, [existingAnswer]);

  // Auto-start recording on mount (only for first-time, no existing answer)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (existingAnswer) return;
    if (mode === "voice") {
      const autoStart = async () => {
        const ok = await start();
        if (ok) {
          setHasStarted(true);
          timerRef.current = setInterval(() => setElapsed((e) => e + 100), 100);
        }
      };
      autoStart();
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setElapsed(0);
    const ok = await start();
    if (ok) {
      setHasStarted(true);
      timerRef.current = setInterval(() => setElapsed((e) => e + 100), 100);
    }
  };

  // Delete all segments and start fresh
  const handleDeleteAll = () => {
    setSegments([]);
    setTextValue("");
    onDeleteAnswer?.();
    setMode("voice");
    startRecording();
  };

  // Delete a single segment
  const handleDeleteSegment = (idx: number) => {
    setSegments((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) {
        // No segments left — start fresh recording
        onDeleteAnswer?.();
        startRecording();
      }
      return next;
    });
  };

  // "Add more" button tapped
  const handleAddMore = async () => {
    setIsAddingMore(true);
    await startRecording();
  };

  // "Done" button tapped (finish adding a segment)
  const handleDoneAdding = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const result = await stop();
    if (result.blob) {
      setSegments((prev) => [
        ...prev,
        { blob: result.blob, url: result.url, durationMs: result.durationMs },
      ]);
    }
    setIsAddingMore(false);
    setHasStarted(false);
  };

  const handleEditExistingText = () => {
    setMode("text");
    setSegments([]);
  };

  const switchToText = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) await stop();
    setMode("text");
    setIsAddingMore(false);
  };

  // Auto-switch to text mode when mic permission is denied
  const [micDeniedNotice, setMicDeniedNotice] = useState(false);
  useEffect(() => {
    if (permissionDenied && mode === "voice") {
      setMicDeniedNotice(true);
      switchToText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionDenied]);

  useEffect(() => {
    if (mode === "text" && !hasSegments) {
      textareaRef.current?.focus();
    }
  }, [mode, hasSegments]);

  const switchToVoice = async () => {
    setTextValue("");
    setMode("voice");
    setMicDeniedNotice(false);
    if (!hasSegments) {
      startRecording();
    }
  };

  const handleNext = async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    // If currently adding more, finish that segment first
    if (isAddingMore && isRecording) {
      if (timerRef.current) clearInterval(timerRef.current);
      const result = await stop();
      if (result.blob) {
        const allSegments = [
          ...segments,
          { blob: result.blob, url: result.url, durationMs: result.durationMs },
        ];
        await produceAnswer(allSegments);
        return;
      }
    }

    if (hasSegments) {
      await produceAnswer(segments);
    } else if (mode === "text") {
      onNext({
        questionId: question.id,
        durationMs: 0,
        textContent: textValue.trim(),
      });
    } else {
      // First-time recording, no segments yet
      if (timerRef.current) clearInterval(timerRef.current);
      const result = await stop();
      onNext({
        questionId: question.id,
        blob: result.blob,
        url: result.url,
        durationMs: result.durationMs,
        segments: [{ blob: result.blob, url: result.url, durationMs: result.durationMs }],
      });
    }
  };

  const produceAnswer = async (segs: VoiceSegment[]) => {
    const blobs = segs.filter((s) => s.blob).map((s) => s.blob!);
    if (blobs.length === 0) {
      // Segments from existing answer without blobs — keep existing
      if (existingAnswer) {
        onNext({ ...existingAnswer, segments: segs });
      }
      return;
    }

    try {
      const merged = await mergeAudioBlobs(blobs);
      onNext({
        questionId: question.id,
        blob: merged.blob,
        url: merged.url,
        durationMs: merged.durationMs,
        segments: segs,
      });
    } catch {
      // Fallback: use last segment
      const last = segs[segs.length - 1];
      onNext({
        questionId: question.id,
        blob: last.blob,
        url: last.url,
        durationMs: segs.reduce((sum, s) => sum + s.durationMs, 0),
        segments: segs,
      });
    }
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) await stop();
    onBack();
  };

  const canSubmit =
    isTransitioning
      ? false
      : hasSegments
      ? true
      : mode === "voice"
      ? hasStarted
      : textValue.trim().length > 0;

  const progress = ((questionIndex + 1) / totalQuestions) * 100;

  const swipe = useSwipeNavigation({
    onSwipeLeft: canSubmit ? handleNext : undefined,
    onSwipeRight: onBack ? handleBack : undefined,
    enabled: !isTransitioning,
  });

  const showExistingText = !!(existingAnswer?.textContent && mode === "text" && segments.length === 0 && textValue === existingAnswer.textContent);

  return (
    <div className="flex flex-col h-full" onTouchStart={swipe.onTouchStart} onTouchEnd={swipe.onTouchEnd}>
      {/* Progress bar */}
      <div className="w-full h-0.5 bg-muted">
        <motion.div
          className="h-full bg-primary origin-left"
          initial={{ scaleX: (questionIndex / totalQuestions) }}
          animate={{ scaleX: progress / 100 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: "left" }}
        />
      </div>

      {/* Header */}
      <motion.div
        className="flex items-center justify-between px-6 pt-4 pb-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <div className="flex items-center gap-3">
          {onBack && (
            <motion.button
              type="button"
              onClick={handleBack}
              className="flex items-center justify-center w-11 h-11 -ml-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </motion.button>
          )}
          <span className="font-display text-xs text-muted-foreground tracking-widest uppercase">
            {questionIndex + 1} / {totalQuestions}
          </span>
        </div>

        {/* Recording timer badge */}
        {mode === "voice" && (isRecording || hasStarted) && !showSegments && (
          <motion.div
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 shadow-md"
            style={{ background: "hsla(225, 20%, 8%, 0.85)" }}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
            <span className="text-sm text-primary font-mono font-medium tabular-nums">
              {formatDuration(elapsed)}
            </span>
          </motion.div>
        )}
      </motion.div>

      {/* Question — centre stage */}
      <motion.div
        className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 gap-4 overflow-y-auto"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {question.hint && (
          <motion.p variants={item} className="text-muted-foreground text-sm text-center">
            {question.hint}
          </motion.p>
        )}
        <motion.h2
          variants={questionItem}
          className="font-display text-xl sm:text-3xl leading-snug text-center text-foreground"
          style={{ fontWeight: 800 }}
        >
          {question.text}
        </motion.h2>
      </motion.div>

      {/* Bottom section */}
      <motion.div
        className="flex flex-col items-center gap-4 px-6 pb-safe flex-shrink-0"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {micDeniedNotice && mode === "text" && (
          <motion.div
            variants={item}
            className="w-full text-center text-xs text-muted-foreground bg-muted/60 rounded-2xl px-4 py-2"
          >
            Mic unavailable — type your answer instead
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {/* Existing text answer pill */}
          {showExistingText ? (
            <motion.div
              key="existing-text"
              className="w-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
            >
              <TextAnswerPill
                text={existingAnswer!.textContent!}
                onEdit={handleEditExistingText}
                onDelete={handleDeleteAll}
              />
            </motion.div>

          /* Segment pills + add more */
          ) : showSegments ? (
            <motion.div
              key="segments"
              className="w-full space-y-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
            >
              {segments.map((seg, idx) => (
                <VoiceNotePill
                  key={`seg-${idx}`}
                  url={seg.url!}
                  durationMs={seg.durationMs}
                  onDelete={() => handleDeleteSegment(idx)}
                />
              ))}

              {/* Add more button */}
              <motion.button
                type="button"
                onClick={handleAddMore}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-display transition-colors"
                style={{
                  fontWeight: 600,
                  background: "hsl(225 15% 10%)",
                  color: "hsl(22, 95%, 62%)",
                  border: "1px solid hsl(225 15% 18%)",
                }}
                whileTap={{ scale: 0.97 }}
                whileHover={{ borderColor: "hsl(22 95% 62% / 0.3)" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" x2="12" y1="19" y2="22"/>
                </svg>
                Add more
              </motion.button>
            </motion.div>

          /* Currently recording (first-time or adding more) */
          ) : mode === "voice" ? (
            <motion.div
              key="waveform"
              variants={item}
              className="w-full space-y-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              <div className="w-full h-16">
                <VoiceWave analyser={analyser} isRecording={isRecording} />
              </div>

            </motion.div>

          /* Text mode */
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
                placeholder="Type your answer..."
                autoFocus
                rows={4}
                className="w-full resize-none rounded-2xl px-4 py-3 text-sm leading-relaxed border border-border bg-muted text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status text */}
        {mode === "voice" && !showSegments && !isAddingMore && (
          <motion.p variants={item} className="text-xs text-muted-foreground">
            {!hasStarted
              ? "Starting microphone..."
              : isRecording
              ? "Recording — speak naturally"
              : "Preparing..."}
          </motion.p>
        )}
        {showSegments && (
          <motion.p variants={item} className="text-xs text-muted-foreground">
            {segments.length} recording{segments.length !== 1 ? "s" : ""} — tap Next to continue, or add more
          </motion.p>
        )}
        {isAddingMore && (
          <motion.p variants={item} className="text-xs text-muted-foreground">
            {isRecording ? "Recording — tap Done below when finished" : "Starting microphone..."}
          </motion.p>
        )}

        {/* Escape hatch toggle */}
        {!isAddingMore && (
          <motion.button
            type="button"
            onClick={mode === "voice" ? switchToText : switchToVoice}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.35, delay: 0.5 } }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm cursor-pointer transition-colors"
            style={{
              background: "hsl(225 15% 12%)",
              color: "hsl(225 10% 50%)",
              border: "1px solid hsl(225 15% 18%)",
            }}
            whileHover={{ borderColor: "hsl(225 15% 25%)", color: "hsl(225 10% 65%)" }}
            whileTap={{ scale: 0.96 }}
          >
            {mode === "voice" ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"><path d="M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm4 2v.01m4-.01v.01m4-.01v.01m4-.01v.01M6 14v.01M18 14v.01M10 14l4 .01"/></svg>
                Type instead?
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                Switch to voice
              </>
            )}
          </motion.button>
        )}

        {/* Main action button — morphs between Done (grey) and Next (orange) */}
        {isAddingMore && hasStarted ? (
          <motion.button
            key="done-btn"
            variants={item}
            onClick={handleDoneAdding}
            className="w-full py-5 rounded-2xl font-display text-lg tracking-wide"
            style={{
              fontWeight: 700,
              background: "hsl(225 15% 14%)",
              color: "hsl(225 10% 60%)",
              border: "1px solid hsl(225 15% 20%)",
            }}
            whileTap={{ scale: 0.96, transition: { duration: 0.07 } }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            Done — save this clip
          </motion.button>
        ) : (
          <motion.button
            key="next-btn"
            variants={item}
            onClick={handleNext}
            disabled={!canSubmit}
            className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-display text-lg tracking-wide glow-primary disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontWeight: 700 }}
            whileTap={canSubmit ? { scale: 0.96, transition: { duration: 0.07 } } : {}}
            whileHover={canSubmit ? { filter: "brightness(1.12)", transition: { duration: 0.12 } } : {}}
          >
            Next
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}

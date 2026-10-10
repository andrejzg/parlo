import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Keyboard, Mic } from "lucide-react";
import VoiceWave from "@/components/VoiceWave";
import VoiceNotePill from "@/components/VoiceNotePill";
import TextAnswerPill from "@/components/TextAnswerPill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SurveyQuestion, VoiceAnswer, VoiceSegment } from "@/types/survey";
import { mergeAudioBlobs } from "@/lib/audioMerge";
import { finalizeRecording } from "@/lib/audioTrim";
import { stagger, fadeUp, questionFadeUp, transitionSmall, transitionLarge } from "@/lib/animations";

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
      const final = await finalizeRecording(result, "answer");
      onNext({
        questionId: question.id,
        blob: final.blob,
        url: final.url,
        durationMs: final.durationMs,
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
      const merged = await finalizeRecording(await mergeAudioBlobs(blobs), "answer");
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
      <div className="w-full h-xxs bg-muted">
        <motion.div
          className="h-full bg-color-1 origin-left"
          initial={{ scaleX: (questionIndex / totalQuestions) }}
          animate={{ scaleX: progress / 100 }}
          transition={transitionLarge}
          style={{ transformOrigin: "left" }}
        />
      </div>

      {/* Header */}
      <motion.div
        className="flex items-center justify-between px-l pt-m pb-xs"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
      >
        <div className="flex items-center gap-s">
          {onBack && (
            <Button type="button" variant="ghost" size="icon" onClick={handleBack} aria-label="Back" className="-ml-xs">
              <ChevronLeft className="!size-6" aria-hidden />
            </Button>
          )}
          <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
            {questionIndex + 1} / {totalQuestions}
          </span>
        </div>

        {/* Recording timer badge */}
        {mode === "voice" && (isRecording || hasStarted) && !showSegments && (
          <motion.div
            className="flex items-center gap-xs rounded-full bg-card px-s py-xxs"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={transitionSmall}
          >
            <span className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
            <span className="font-data text-s font-medium tabular-nums text-color-1">
              {formatDuration(elapsed)}
            </span>
          </motion.div>
        )}
      </motion.div>

      {/* Question — centre stage */}
      <motion.div
        className="flex-1 min-h-0 flex flex-col items-center justify-center px-l gap-m overflow-y-auto"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {question.hint && (
          <motion.p variants={fadeUp} className="text-s text-muted-foreground text-center">
            {question.hint}
          </motion.p>
        )}
        <motion.h2
          variants={questionFadeUp}
          className="font-editorial text-l sm:text-xl font-medium text-center text-foreground"
        >
          {question.text}
        </motion.h2>
      </motion.div>

      {/* Bottom section */}
      <motion.div
        className="flex flex-col items-center gap-m px-l pb-safe flex-shrink-0"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {micDeniedNotice && mode === "text" && (
          <motion.div
            variants={fadeUp}
            className="w-full text-center rounded-s bg-muted px-m py-xs text-xs text-muted-foreground"
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
              exit={{ opacity: 0, y: -8, transition: transitionSmall }}
              transition={transitionSmall}
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
              className="w-full space-y-xs"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: transitionSmall }}
              transition={transitionSmall}
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
              <Button type="button" variant="secondary" className="w-full" onClick={handleAddMore}>
                <Mic aria-hidden />
                Add more
              </Button>
            </motion.div>

          /* Currently recording (first-time or adding more) */
          ) : mode === "voice" ? (
            <motion.div
              key="waveform"
              variants={fadeUp}
              className="w-full space-y-s"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: transitionSmall }}
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
              animate={{ opacity: 1, y: 0, transition: transitionLarge }}
              exit={{ opacity: 0, transition: transitionSmall }}
            >
              <Textarea
                ref={textareaRef}
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder="Type your answer..."
                autoFocus
                rows={4}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status text */}
        {mode === "voice" && !showSegments && !isAddingMore && (
          <motion.p variants={fadeUp} className="text-xs text-muted-foreground">
            {!hasStarted
              ? "Starting microphone..."
              : isRecording
              ? "Recording — speak naturally"
              : "Preparing..."}
          </motion.p>
        )}
        {showSegments && (
          <motion.p variants={fadeUp} className="text-xs text-muted-foreground">
            {segments.length} recording{segments.length !== 1 ? "s" : ""} — tap Next to continue, or add more
          </motion.p>
        )}
        {isAddingMore && (
          <motion.p variants={fadeUp} className="text-xs text-muted-foreground">
            {isRecording ? "Recording — tap Done below when finished" : "Starting microphone..."}
          </motion.p>
        )}

        {/* Escape hatch toggle — appears a beat later so voice stays the primary path */}
        {!isAddingMore && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { ...transitionLarge, delay: 0.5 } }}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={mode === "voice" ? switchToText : switchToVoice}
            >
              {mode === "voice" ? (
                <>
                  <Keyboard aria-hidden />
                  Type instead?
                </>
              ) : (
                <>
                  <Mic aria-hidden />
                  Switch to voice
                </>
              )}
            </Button>
          </motion.div>
        )}

        {/* Main action button — Done (secondary) while adding a clip, otherwise Next (primary) */}
        {isAddingMore && hasStarted ? (
          <motion.div
            key="done-btn"
            className="w-full"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitionLarge}
          >
            <Button size="lg" variant="secondary" className="w-full" onClick={handleDoneAdding}>
              Done — save this clip
            </Button>
          </motion.div>
        ) : (
          <motion.div key="next-btn" variants={fadeUp} className="w-full">
            <Button size="lg" className="w-full" onClick={handleNext} disabled={!canSubmit}>
              Next
            </Button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

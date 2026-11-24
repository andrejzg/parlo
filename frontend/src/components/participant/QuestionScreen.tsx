import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Keyboard, LoaderCircle, Mic } from "lucide-react";
import VoiceWave from "@/components/VoiceWave";
import VoiceNotePill from "@/components/VoiceNotePill";
import TextAnswerPill from "@/components/TextAnswerPill";
import ProbeCard from "@/components/participant/ProbeCard";
import TestimonialNotice from "@/components/participant/TestimonialNotice";
import { useAnswerProbe, type FollowUp, type ProbeFn } from "@/components/participant/useAnswerProbe";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { SurveyQuestion, VoiceAnswer, VoiceSegment } from "@/types/survey";
import { mergeAudioBlobs } from "@/lib/audioMerge";
import { finalizeRecording } from "@/lib/audioTrim";
import { trackEvent } from "@/lib/posthog";
import { cn } from "@/lib/utils";
import { stagger, fadeUp, questionFadeUp, transitionSmall, transitionLarge } from "@/lib/animations";

/**
 * Next was tapped before the agent's verdict on the latest clip came back:
 * the longest the participant is held on the question, counted from the tap.
 * Speech-to-text and the judgment take two to three seconds on a short answer
 * and longer on a long one, and the long, wandering answers are the ones that
 * need the follow-up; a follow-up that misses this window is never shown.
 */
const PROBE_HOLD_MS = 6000;

interface QuestionScreenProps {
  question: SurveyQuestion;
  questionIndex: number;
  totalQuestions: number;
  isLast: boolean;
  existingAnswer?: VoiceAnswer;
  onNext: (answer: VoiceAnswer) => void;
  onBack?: () => void;
  onDeleteAnswer?: () => void;
  /**
   * A study only: let the agent hear each voice take as it is recorded. It
   * may come back with one short follow-up, shown on this screen. Leave it
   * out (every other parlo, testimonial asks) and nothing here changes.
   */
  probe?: ProbeFn;
  /** A follow-up went on screen (the page tells the server, which keeps only those). */
  onProbeShown?: (text: string) => void;
  /**
   * A follow-up is keeping the participant here with audio the page has not
   * been handed yet: keep it safe (so going back or a reload cannot lose it)
   * without moving on.
   */
  onKeep?: (answer: VoiceAnswer) => void;
  /**
   * A testimonial ask (`question.purpose === "testimonial"`): the notice
   * shown above the recording control. `onShown` fires when it is on screen.
   */
  testimonial?: { notice?: string; currency?: string; onShown?: () => void };
  /** "I'd rather not" on a testimonial ask. Leave it out and the action is not offered. */
  onDecline?: () => void;
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
  probe,
  onProbeShown,
  onKeep,
  testimonial,
  onDecline,
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

  // Probing (study only): the agent's follow-up on this answer, if it has one.
  const probing = useAnswerProbe(question.id, probe, onProbeShown);
  // Next is waiting, briefly, for the agent's verdict on the latest clip.
  const [holding, setHolding] = useState(false);
  // Bumped when the answer is recorded again from scratch and when the
  // participant leaves: a draft still being put together is then dropped.
  const answerEpochRef = useRef(0);

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

  // A testimonial ask never records by itself. Recording it is the consent to
  // public use, so the mic waits for a tap made with the notice on screen.
  const [tapStarted, setTapStarted] = useState(false);

  // Determine view state
  const hasSegments = segments.length > 0;
  // The agent's follow-up, for as long as it can be answered by voice.
  const followUp = mode === "voice" ? probing.followUp : null;
  // It is on the table and not being answered right now: its card stands in
  // for the list of recordings, and "Answer" is the main action.
  const askingFollowUp = !!followUp && !isAddingMore;
  const showSegments = hasSegments && !isAddingMore && mode === "voice" && !askingFollowUp;
  const isFirstRecording = !hasSegments && !existingAnswer?.textContent && mode === "voice" && !isAddingMore;
  // Testimonial ask, nothing recorded and the mic not yet asked for: "Record it" is the main action.
  const needsTap = !!testimonial && isFirstRecording && !tapStarted;

  useEffect(() => {
    if (testimonial) trackEvent("testimonial_ask_shown", { questionId: question.id });
    // Once per time the ask is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (existingAnswer || testimonial) return;
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

  /** A fresh take: at once on an ordinary question, on the next tap on a testimonial ask. */
  const recordAgain = () => {
    if (testimonial) {
      setTapStarted(false);
      setHasStarted(false);
      setElapsed(0);
    } else {
      startRecording();
    }
  };

  // "Record it" on a testimonial ask.
  const handleTapRecord = async () => {
    if (tapStarted || isTransitioning) return;
    setTapStarted(true);
    trackEvent("testimonial_record_tapped", { questionId: question.id });
    await startRecording();
  };

  /** The answer is being recorded again from scratch: the agent's follow-up belonged to the old take. */
  const startOver = () => {
    answerEpochRef.current += 1;
    probing.reset();
  };

  /** The answer is being handed up (or given up): nothing that arrives late may touch it. */
  const leaving = () => {
    answerEpochRef.current += 1;
    probing.leave();
  };

  /**
   * Study only. A clip has gone to the agent. If it comes back with a
   * follow-up the participant stays on this question, so what they have
   * recorded so far is handed to the page for safekeeping (as recorded: it is
   * trimmed and uploaded when they move on).
   */
  const keepIfAsked = (verdict: Promise<FollowUp | null> | null, segs: VoiceSegment[]) => {
    if (!verdict || !onKeep) return;
    const epoch = answerEpochRef.current;
    verdict.then(async (asked) => {
      if (!asked) return;
      const draft = await buildAnswer(segs, false);
      if (draft && epoch === answerEpochRef.current) onKeep(draft);
    });
  };

  /**
   * Next was tapped while the agent is still judging the latest clip. Wait
   * for it, but never past PROBE_HOLD_MS from the tap. True when a follow-up
   * arrived: it is showing now and the participant stays on this question.
   */
  const waitForFollowUp = async (tappedAt: number): Promise<boolean> => {
    const pending = probing.pending();
    if (!pending) return false;
    setHolding(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeUp = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), Math.max(0, PROBE_HOLD_MS - (Date.now() - tappedAt)));
    });
    const asked = await Promise.race([pending, timeUp]);
    clearTimeout(timer);
    setHolding(false);
    if (!asked) return false;
    setIsTransitioning(false);
    return true;
  };

  // Delete all segments and start fresh
  const handleDeleteAll = () => {
    startOver();
    setSegments([]);
    setTextValue("");
    onDeleteAnswer?.();
    setMode("voice");
    recordAgain();
  };

  // Delete a single segment
  const handleDeleteSegment = (idx: number) => {
    // The last recording is going: the answer starts over.
    if (segments.length <= 1) startOver();
    setSegments((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) {
        // No segments left — start fresh recording
        onDeleteAnswer?.();
        recordAgain();
      }
      return next;
    });
  };

  // "Add more" button tapped
  const handleAddMore = async () => {
    setIsAddingMore(true);
    await startRecording();
  };

  // "Answer" on the agent's follow-up: a further clip of the same answer,
  // recorded through the "Add more" path.
  const handleAnswerFollowUp = () => {
    if (isTransitioning) return;
    probing.answering();
    handleAddMore();
  };

  // "Done" button tapped (finish adding a segment)
  const handleDoneAdding = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const result = await stop();
    if (result.blob) {
      const clip: VoiceSegment = { blob: result.blob, url: result.url, durationMs: result.durationMs };
      setSegments((prev) => [...prev, clip]);
      // If this clip answers a follow-up, the agent hears it now, in the background.
      keepIfAsked(probing.heardClip(result.blob), [...segments, clip]);
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
      recordAgain();
    }
  };

  const handleNext = async () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    const tappedAt = Date.now();

    // If currently adding more, finish that segment first
    if (isAddingMore && isRecording) {
      if (timerRef.current) clearInterval(timerRef.current);
      const result = await stop();
      if (result.blob) {
        const allSegments = [
          ...segments,
          { blob: result.blob, url: result.url, durationMs: result.durationMs },
        ];
        // If the clip answers a follow-up, the agent hears it before the
        // participant moves on (it may have one more).
        keepIfAsked(probing.heardClip(result.blob), allSegments);
        if (probing.pending()) {
          setSegments(allSegments);
          setIsAddingMore(false);
          setHasStarted(false);
          if (await waitForFollowUp(tappedAt)) return;
        }
        leaving();
        await produceAnswer(allSegments);
        return;
      }
    }

    // Next while a follow-up is on the table counts as skipping it.
    probing.skip();

    if (hasSegments) {
      // A clip saved with "Done" may still be with the agent.
      if (await waitForFollowUp(tappedAt)) return;
      leaving();
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
      if (probing.enabled) {
        // Study: the agent hears the take now. If it comes back in time with a
        // follow-up, the take becomes the first clip of the answer and the
        // participant stays here; otherwise the flow is the usual one.
        const take: VoiceSegment = { blob: result.blob, url: result.url, durationMs: result.durationMs };
        keepIfAsked(probing.heardTake(result.blob), [take]);
        if (await waitForFollowUp(tappedAt)) {
          setSegments([take]);
          setHasStarted(false);
          return;
        }
        leaving();
      }
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

  /**
   * One answer out of every clip recorded for this question. `trim: false`
   * leaves the audio as recorded (a draft kept while a follow-up is showing).
   * Null when there is nothing to hand up.
   */
  const buildAnswer = async (segs: VoiceSegment[], trim = true): Promise<VoiceAnswer | null> => {
    const blobs = segs.filter((s) => s.blob).map((s) => s.blob!);
    if (blobs.length === 0) {
      // Segments from existing answer without blobs — keep existing
      return existingAnswer ? { ...existingAnswer, segments: segs } : null;
    }

    try {
      const joined = await mergeAudioBlobs(blobs);
      const merged = trim ? await finalizeRecording(joined, "answer") : joined;
      return {
        questionId: question.id,
        blob: merged.blob,
        url: merged.url,
        durationMs: merged.durationMs,
        segments: segs,
      };
    } catch {
      // Fallback: use last segment
      const last = segs[segs.length - 1];
      return {
        questionId: question.id,
        blob: last.blob,
        url: last.url,
        durationMs: segs.reduce((sum, s) => sum + s.durationMs, 0),
        segments: segs,
      };
    }
  };

  const produceAnswer = async (segs: VoiceSegment[]) => {
    const answer = await buildAnswer(segs);
    if (answer) onNext(answer);
  };

  const handleBack = async () => {
    if (!onBack || isTransitioning) return;
    setIsTransitioning(true);
    // No more follow-ups on a screen that is going away. A draft on its way to
    // the page is still wanted, so the epoch stays as it is.
    probing.leave();
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) await stop();
    onBack();
  };

  // "I'd rather not" on a testimonial ask: whatever is being recorded is
  // dropped, and the page takes the ask out of this sitting.
  const handleDecline = async () => {
    if (!onDecline || isTransitioning) return;
    setIsTransitioning(true);
    leaving();
    trackEvent("testimonial_declined_tapped", { questionId: question.id });
    if (timerRef.current) clearInterval(timerRef.current);
    if (isRecording) await stop();
    onDecline();
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

      {/* Question — centre stage. A testimonial notice or a follow-up card
          takes room from it; on a small phone the question may then be taller
          than what is left. `justify-center` would cut its top off, out of
          reach of the scroll, so those two cases centre with a spacer on each
          side instead (`before:` / `after:`): the same look while it fits, and
          the question scrolls from its first line when it does not. */}
      <motion.div
        className={`flex-1 min-h-0 flex flex-col items-center px-l gap-m overflow-y-auto ${
          testimonial || followUp ? "before:flex-1 after:flex-1" : "justify-center"
        }`}
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

        {/* Testimonial ask: who may use the recording, before anything is recorded */}
        {testimonial && (
          <motion.div variants={fadeUp} className="w-full">
            <TestimonialNotice
              notice={testimonial.notice}
              rewardCents={question.rewardCents}
              currency={testimonial.currency}
              onShown={testimonial.onShown}
            />
          </motion.div>
        )}

        {/* The agent's follow-up (study). It stays on screen while it is being answered. */}
        {followUp && (
          <motion.div
            key={`follow-up-${followUp.n}`}
            className="w-full"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitionLarge}
          >
            <ProbeCard
              text={followUp.text}
              n={followUp.n}
              recording={isAddingMore}
              onAnswer={handleAnswerFollowUp}
              onSkip={handleNext}
            />
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

          /* A follow-up is on the table: its card (above) stands in for the recordings */
          ) : askingFollowUp ? null

          /* Segment pills + add more */
          : showSegments ? (
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
                  onDelete={holding ? undefined : () => handleDeleteSegment(idx)}
                />
              ))}

              {/* Add more button. While Next is waiting for the agent it keeps its
                  place (nothing jumps) but is out of sight and out of reach. */}
              <Button
                type="button"
                variant="secondary"
                className={cn("w-full", holding && "invisible")}
                onClick={handleAddMore}
              >
                <Mic aria-hidden />
                Add more
              </Button>
            </motion.div>

          /* Currently recording (first-time or adding more) */
          ) : needsTap ? null

          : mode === "voice" ? (
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
        {mode === "voice" && !showSegments && !isAddingMore && !askingFollowUp && (
          <motion.p variants={fadeUp} className="text-xs text-muted-foreground">
            {needsTap
              ? "Nothing is recorded until you tap."
              : !hasStarted
              ? "Starting microphone..."
              : isRecording
              ? "Recording — speak naturally"
              : "Preparing..."}
          </motion.p>
        )}
        {showSegments && (
          <motion.p variants={fadeUp} className={cn("text-xs text-muted-foreground", holding && "invisible")}>
            {segments.length} recording{segments.length !== 1 ? "s" : ""} — tap Next to continue, or add more
          </motion.p>
        )}
        {isAddingMore && (
          <motion.p variants={fadeUp} className="text-xs text-muted-foreground">
            {!isRecording ? "Starting microphone..." : followUp ? "Recording — tap Next when finished" : "Recording — tap Done below when finished"}
          </motion.p>
        )}

        {/* Escape hatch toggle — appears a beat later so voice stays the primary path.
            Gone while a follow-up is on the table; while Next is waiting for the
            agent it keeps its place but is out of sight and out of reach. A
            testimonial ask adds its quiet way out beside it. */}
        {!isAddingMore && !askingFollowUp && (
          <motion.div
            className={cn(onDecline && "flex flex-wrap items-center justify-center gap-s", holding && "invisible") || undefined}
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
            {onDecline && (
              <Button type="button" variant="ghost" size="sm" onClick={handleDecline} data-testid="testimonial-decline">
                I'd rather not
              </Button>
            )}
          </motion.div>
        )}

        {/* Main action button.
            - A testimonial ask before the tap: "Record it".
            - A follow-up on the table: none here, its card holds both choices.
            - Answering a follow-up: Next (it saves the clip and moves on, or
              stays if the agent has one more).
            - Adding a clip: Done (secondary). Otherwise Next. */}
        {needsTap ? (
          <motion.div key="record-btn" variants={fadeUp} className="w-full">
            <Button size="lg" className="w-full" onClick={handleTapRecord} disabled={isTransitioning} data-testid="testimonial-record">
              <Mic aria-hidden />
              Record it
            </Button>
          </motion.div>
        ) : askingFollowUp ? null : isAddingMore && hasStarted && !followUp ? (
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
            <Button size="lg" className="w-full" onClick={handleNext} disabled={!canSubmit} aria-busy={holding || undefined}>
              {holding ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden />
                  One moment…
                </>
              ) : (
                "Next"
              )}
            </Button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

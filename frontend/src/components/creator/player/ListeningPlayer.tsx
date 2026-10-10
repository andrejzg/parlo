import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleCheckBig, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { transitionLarge } from "@/lib/animations";
import { useFeedBuffer } from "@/hooks/useFeedBuffer";
import { useSwipe2D } from "@/hooks/useSwipe2D";
import PlayerCard from "./PlayerCard";
import PlayerProgressBar from "./PlayerProgressBar";
import SurveyBadge from "./SurveyBadge";
import SpeedControl from "./SpeedControl";
import type { FeedItem } from "@/api/client";

interface ListeningPlayerProps {
  apiKey: string;
  onExit: () => void; // navigate back to home/survey list
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ListeningPlayer({ apiKey, onExit }: ListeningPlayerProps) {
  const { items, loading, loadMore, hasMore, markRead, totalUnread } =
    useFeedBuffer({ apiKey, pageSize: 5 });

  // 2D navigation state
  const [respondentIdx, setRespondentIdx] = useState(0);
  const [answerIdx, setAnswerIdx] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [transitionDir, setTransitionDir] = useState<"up" | "down" | "left" | "right" | null>(null);

  // Progress bar fill (0-1) for active segment
  const [activeProgress, setActiveProgress] = useState(0);
  const progressGenRef = useRef(0);

  const currentItem = items[respondentIdx] as FeedItem | undefined;
  const currentAnswer = currentItem?.answers[answerIdx];
  const totalAnswers = currentItem?.answers.length ?? 0;

  // Pre-fetch when approaching the end of the buffer
  useEffect(() => {
    if (hasMore && items.length - respondentIdx <= 2) {
      loadMore();
    }
  }, [respondentIdx, items.length, hasMore, loadMore]);

  // Mark as read when a respondent is viewed
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentItem && !currentItem.response.isRead && currentItem.response.id !== lastMarkedRef.current) {
      lastMarkedRef.current = currentItem.response.id;
      markRead(currentItem.response.id);
    }
  }, [currentItem, markRead]);

  // Navigation handlers
  const goToRespondent = useCallback((dir: "up" | "down") => {
    setTransitionDir(dir);
    setAnswerIdx(0);
    setActiveProgress(0);
    progressGenRef.current += 1;
    setRespondentIdx((prev) => {
      const next = dir === "up" ? prev + 1 : prev - 1;
      return Math.max(0, Math.min(next, items.length - 1));
    });
  }, [items.length]);

  const goToAnswer = useCallback((dir: "left" | "right") => {
    setTransitionDir(dir);
    setActiveProgress(0);
    progressGenRef.current += 1;
    setAnswerIdx((prev) => {
      const next = dir === "right" ? prev + 1 : prev - 1;
      return Math.max(0, Math.min(next, totalAnswers - 1));
    });
  }, [totalAnswers]);

  const canSwipeUp = respondentIdx < items.length - 1;
  const canSwipeDown = respondentIdx > 0;
  const canSwipeRight = answerIdx < totalAnswers - 1;
  const canSwipeLeft = answerIdx > 0;

  const { handlers, offset, isSwiping } = useSwipe2D({
    onSwipeUp: () => goToRespondent("up"),
    onSwipeDown: () => goToRespondent("down"),
    onSwipeRight: () => goToAnswer("right"),
    onSwipeLeft: () => goToAnswer("left"),
    canSwipeUp,
    canSwipeDown,
    canSwipeRight,
    canSwipeLeft,
  });

  // Keyboard navigation for desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
          if (canSwipeRight) goToAnswer("right");
          break;
        case "ArrowLeft":
          if (canSwipeLeft) goToAnswer("left");
          break;
        case "ArrowUp":
          e.preventDefault();
          if (canSwipeDown) goToRespondent("down");
          break;
        case "ArrowDown":
          e.preventDefault();
          if (canSwipeUp) goToRespondent("up");
          break;
        case "Escape":
          onExit();
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canSwipeUp, canSwipeDown, canSwipeLeft, canSwipeRight, goToAnswer, goToRespondent, onExit]);

  const handleAudioEnd = useCallback(() => {
    // Auto-advance to next answer within same respondent
    if (answerIdx < totalAnswers - 1) {
      setTimeout(() => goToAnswer("right"), 800);
    } else if (respondentIdx < items.length - 1) {
      setTimeout(() => goToRespondent("up"), 800);
    }
  }, [answerIdx, totalAnswers, respondentIdx, items.length, goToAnswer, goToRespondent]);

  const handleTimerEnd = useCallback(() => {
    // Photo/video ended — advance to next answer or next respondent
    if (answerIdx < totalAnswers - 1) {
      goToAnswer("right");
    } else if (respondentIdx < items.length - 1) {
      goToRespondent("up");
    }
  }, [answerIdx, totalAnswers, respondentIdx, items.length, goToAnswer, goToRespondent]);

  const cardKey = `${currentItem?.response.id}-${answerIdx}`;

  const currentGen = progressGenRef.current;
  const handleProgress = useCallback((p: number) => {
    if (currentGen === progressGenRef.current) {
      setActiveProgress(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGen]);

  const cycleSpeed = useCallback(() => {
    setPlaybackSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1));
  }, []);

  // Respondent display info
  const respondentName = currentItem
    ? [currentItem.response.firstName, currentItem.response.lastName].filter(Boolean).join(" ") || "Anonymous"
    : "";
  const respondentInitial = respondentName.charAt(0).toUpperCase();

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-s bg-background">
        <LoaderCircle size={32} className="animate-spin text-color-1" aria-hidden />
        <p className="text-s text-muted-foreground">Loading responses...</p>
      </div>
    );
  }

  // Empty / all caught up
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-l bg-background px-l">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card text-neutral-6">
          <CircleCheckBig size={28} aria-hidden />
        </div>
        <div className="space-y-xs text-center">
          <h2 className="font-brand text-l font-heavy text-foreground">You're all caught up</h2>
          <p className="text-s text-muted-foreground">Share your parlos to get more responses</p>
        </div>
        <Button onClick={onExit}>Go to parlos</Button>
      </div>
    );
  }


  // Animation variants based on swipe direction
  const slideVariants = {
    enter: (dir: string | null) => ({
      x: dir === "right" ? "100%" : dir === "left" ? "-100%" : 0,
      y: dir === "up" ? "100%" : dir === "down" ? "-100%" : 0,
      opacity: 0.5,
    }),
    center: { x: 0, y: 0, opacity: 1 },
    exit: (dir: string | null) => ({
      x: dir === "right" ? "-100%" : dir === "left" ? "100%" : 0,
      y: dir === "up" ? "-100%" : dir === "down" ? "100%" : 0,
      opacity: 0.5,
    }),
  };

  return (
    <div
      className="relative flex h-full select-none flex-col overflow-hidden bg-background"
      {...handlers}
    >
      {/* Top bar: exit + survey badge + progress */}
      <div className="absolute left-0 right-0 top-0 z-20 space-y-s px-m pt-m">
        {/* Survey badge row */}
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="icon" onClick={onExit} aria-label="Exit player">
            <X aria-hidden />
          </Button>
          {currentItem && (
            <SurveyBadge title={currentItem.surveyTitle} />
          )}
          <div className="w-11" /> {/* spacer for centering */}
        </div>

        {/* Progress bar */}
        {totalAnswers > 0 && (
          <PlayerProgressBar totalSegments={totalAnswers} activeSegment={answerIdx} activeProgress={activeProgress} />
        )}
      </div>

      {/* Card area with swipe visual feedback */}
      <div
        className={`relative flex-1 ${isSwiping ? "transition-none" : "transition-transform duration-large ease-large"}`}
        style={{
          transform: isSwiping ? `translate(${offset.x * 0.4}px, ${offset.y * 0.4}px)` : undefined,
        }}
      >
        <AnimatePresence mode="wait" custom={transitionDir}>
          {currentAnswer && currentItem && (
            <motion.div
              key={cardKey}
              className="absolute inset-0"
              custom={transitionDir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transitionLarge}
            >
              <PlayerCard
                questionText={currentAnswer.questionText}
                questionType={currentAnswer.questionType}
                audioUrl={currentAnswer.audioUrl}
                imageUrl={currentAnswer.imageUrl}
                videoUrl={currentAnswer.videoUrl}
                transcription={currentAnswer.transcription}
                transcriptionStatus={currentAnswer.transcriptionStatus}
                durationMs={currentAnswer.durationMs}
                isActive={true}
                playbackSpeed={playbackSpeed}
                onAudioEnd={handleAudioEnd}
                onProgress={handleProgress}
                onTimerEnd={handleTimerEnd}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Desktop click zones for navigation */}
        {canSwipeLeft && (
          <button
            onClick={() => goToAnswer("left")}
            className="hidden sm:block absolute left-0 top-[20%] bottom-[20%] w-[25%] z-10 cursor-pointer"
            aria-label="Previous answer"
          />
        )}
        {canSwipeRight && (
          <button
            onClick={() => goToAnswer("right")}
            className="hidden sm:block absolute right-0 top-[20%] bottom-[20%] w-[25%] z-10 cursor-pointer"
            aria-label="Next answer"
          />
        )}
        {canSwipeUp && (
          <button
            onClick={() => goToRespondent("up")}
            className="hidden sm:block absolute bottom-0 left-[25%] right-[25%] h-[20%] z-10 cursor-pointer"
            aria-label="Next respondent"
          />
        )}
        {canSwipeDown && (
          <button
            onClick={() => goToRespondent("down")}
            className="hidden sm:block absolute top-0 left-[25%] right-[25%] h-[20%] z-10 cursor-pointer"
            aria-label="Previous respondent"
          />
        )}
      </div>

      {/* Bottom bar: respondent info + controls. The scrim keeps the name
          readable over photo/video cards; on voice cards it is invisible. */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-background from-60% to-transparent px-l pb-l pt-xxl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-s">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted font-brand text-xs font-medium text-neutral-8">
              {respondentInitial}
            </div>
            <div>
              <p className="font-brand text-m font-medium text-foreground">
                {respondentName}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatTimeAgo(currentItem?.response.submittedAt ?? null)}
                {items.length > 1 && (
                  <span className="ml-xs">{respondentIdx + 1} of {items.length}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-xs">
            {currentAnswer?.questionType === "voice" && (
              <SpeedControl speed={playbackSpeed} onToggle={cycleSpeed} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

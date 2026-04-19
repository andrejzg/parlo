import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
      <div
        className="flex flex-col items-center justify-center h-full gap-3"
        style={{ background: "hsl(225 25% 4%)" }}
      >
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "hsl(22 95% 62%)", borderTopColor: "transparent" }}
        />
        <p className="text-sm font-display" style={{ color: "hsl(225 10% 45%)" }}>
          Loading responses...
        </p>
      </div>
    );
  }

  // Empty / all caught up
  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-5 px-6"
        style={{ background: "hsl(225 25% 4%)" }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: "hsl(225 15% 10%)" }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 35%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <div className="text-center space-y-2">
          <h2 className="font-display text-xl font-bold" style={{ color: "hsl(40 20% 95%)" }}>
            You're all caught up
          </h2>
          <p className="text-sm font-light" style={{ color: "hsl(225 10% 45%)" }}>
            Share your surveys to get more responses
          </p>
        </div>
        <button
          onClick={onExit}
          className="px-6 py-3 rounded-xl font-display font-semibold text-sm"
          style={{
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
          }}
        >
          Go to surveys
        </button>
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
      className="relative flex flex-col h-full overflow-hidden select-none"
      style={{ background: "hsl(225 25% 4%)" }}
      {...handlers}
    >
      {/* Top bar: exit + survey badge + progress */}
      <div className="absolute top-0 left-0 right-0 z-20 px-4 pt-4 space-y-3">
        {/* Survey badge row */}
        <div className="flex items-center justify-between">
          <button
            onClick={onExit}
            className="flex items-center justify-center w-8 h-8 rounded-full"
            style={{ background: "hsl(225 15% 10% / 0.7)", color: "hsl(225 10% 55%)" }}
            aria-label="Exit player"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          {currentItem && (
            <SurveyBadge title={currentItem.surveyTitle} />
          )}
          <div className="w-8" /> {/* spacer for centering */}
        </div>

        {/* Progress bar */}
        {totalAnswers > 0 && (
          <PlayerProgressBar totalSegments={totalAnswers} activeSegment={answerIdx} activeProgress={activeProgress} />
        )}
      </div>

      {/* Card area with swipe visual feedback */}
      <div
        className="flex-1 relative"
        style={{
          transform: isSwiping ? `translate(${offset.x * 0.4}px, ${offset.y * 0.4}px)` : undefined,
          transition: isSwiping ? "none" : "transform 0.3s ease",
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
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
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

      {/* Bottom bar: respondent info + controls */}
      <div className="absolute bottom-0 left-0 right-0 z-20 px-5 pb-6 pt-12"
        style={{ background: "linear-gradient(transparent, hsl(225 25% 4%) 40%)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-display font-bold"
              style={{
                background: "hsl(var(--primary) / 0.15)",
                color: "hsl(var(--primary))",
              }}
            >
              {respondentInitial}
            </div>
            <div>
              <p className="text-sm font-display font-semibold" style={{ color: "hsl(40 20% 95%)" }}>
                {respondentName}
              </p>
              <p className="text-[10px]" style={{ color: "hsl(225 10% 40%)" }}>
                {formatTimeAgo(currentItem?.response.submittedAt ?? null)}
                {items.length > 1 && (
                  <span className="ml-2">{respondentIdx + 1} of {items.length}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentAnswer?.questionType === "voice" && (
              <SpeedControl speed={playbackSpeed} onToggle={cycleSpeed} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

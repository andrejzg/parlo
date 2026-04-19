import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type {
  DashboardData,
  DashboardResponse,
  DashboardAnswer,
  DashboardQuestion,
  DashboardSurvey,
} from "@/types/survey";
import { fetchDashboardPage, fetchDashboardSince, deleteSurvey, fetchSurveyMembers } from "@/api/client";
import type { SurveyMember } from "@/api/client";
import { buildShareUrl } from "@/lib/slug";
import { useNavigate } from "react-router-dom";
import { getDeviceAuth } from "@/lib/sessionStore";

interface AgentDashboardProps {
  data: DashboardData;
  dashboardCode: string;
}

type SortMode = "latest" | "by-question";

const POLL_INTERVAL_MS = 3000;
const PAGE_SIZE = 20;

// ── Helpers ──────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** A single flattened feed item = one answer from one respondent. */
interface FeedItem {
  id: string;
  responseId: string;
  respondentName: string;
  respondentInitial: string;
  submittedAt: string | null;
  questionText: string;
  questionSort: number;
  answer: DashboardAnswer;
}

function buildFeed(
  responses: DashboardResponse[],
  questions: DashboardQuestion[],
  sort: SortMode,
): FeedItem[] {
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  const items: FeedItem[] = [];
  for (const resp of responses) {
    const name =
      [resp.firstName, resp.lastName].filter(Boolean).join(" ") || "Anonymous";
    for (const answer of resp.answers) {
      const q = questionMap.get(answer.question_id);
      if (!q) continue;
      items.push({
        id: answer.id,
        responseId: resp.id,
        respondentName: name,
        respondentInitial: name.charAt(0).toUpperCase(),
        submittedAt: resp.submittedAt,
        questionText: q.text,
        questionSort: q.sort_order,
        answer,
      });
    }
  }

  if (sort === "latest") {
    items.sort(
      (a, b) =>
        new Date(b.submittedAt ?? 0).getTime() -
        new Date(a.submittedAt ?? 0).getTime(),
    );
  } else {
    items.sort((a, b) => {
      if (a.questionSort !== b.questionSort)
        return a.questionSort - b.questionSort;
      return (
        new Date(b.submittedAt ?? 0).getTime() -
        new Date(a.submittedAt ?? 0).getTime()
      );
    });
  }

  return items;
}

// ── Audio Player ─────────────────────────────────────────────────────────

function AudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafRef = useRef<number>(0);

  function tick() {
    if (audioRef.current) {
      setElapsed(audioRef.current.currentTime);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function toggle() {
    if (!audioRef.current) {
      const el = new Audio(url);
      audioRef.current = el;
      el.onloadedmetadata = () => {
        if (isFinite(el.duration)) setDuration(el.duration);
      };
      el.ondurationchange = () => {
        if (isFinite(el.duration)) setDuration(el.duration);
      };
      el.onended = () => {
        setPlaying(false);
        cancelAnimationFrame(rafRef.current);
        setElapsed(0);
      };
    }
    if (playing) {
      audioRef.current.pause();
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
    } else {
      audioRef.current.play();
      rafRef.current = requestAnimationFrame(tick);
      setPlaying(true);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
    };
  }, []);

  const displayTime =
    playing || elapsed > 0
      ? duration > 0
        ? `${formatDuration(elapsed * 1000)} / ${formatDuration(duration * 1000)}`
        : formatDuration(elapsed * 1000)
      : "Play";

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2.5 rounded-xl px-4 py-2.5"
      style={{ background: "hsl(225 15% 12%)" }}
    >
      {playing ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="hsl(var(--primary))">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="hsl(var(--primary))">
          <polygon points="5,3 19,12 5,21" />
        </svg>
      )}
      <span
        className="text-xs font-display font-medium"
        style={{ color: "hsl(40 20% 80%)" }}
      >
        {displayTime}
      </span>
    </button>
  );
}

// ── Feed Card ────────────────────────────────────────────────────────────

function FeedCard({ item, isNew }: { item: FeedItem; isNew?: boolean }) {
  const { answer } = item;
  const isPhoto = !!answer.imageUrl;
  const isVideo = !!answer.videoUrl;
  const isVoice = !!answer.audioUrl && !isPhoto && !isVideo;
  const hasTranscription =
    answer.transcription && answer.transcriptionStatus === "completed";

  return (
    <motion.div
      initial={isNew ? { opacity: 0, y: -20, scale: 0.97 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(225 15% 8%)",
        border: "1px solid hsl(225 15% 12%)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-display font-bold"
          style={{
            background: "hsl(var(--primary) / 0.15)",
            color: "hsl(var(--primary))",
          }}
        >
          {item.respondentInitial}
        </div>
        <div className="flex-1 min-w-0">
          <span
            className="text-sm font-display font-semibold"
            style={{ color: "hsl(40 20% 95%)" }}
          >
            {item.respondentName}
          </span>
          <span className="text-xs ml-2" style={{ color: "hsl(225 10% 35%)" }}>
            {formatTimeAgo(item.submittedAt)}
          </span>
        </div>
      </div>

      {/* Question */}
      <p
        className="px-4 pb-2 text-xs font-display leading-snug"
        style={{ color: "hsl(225 10% 50%)" }}
      >
        {item.questionText}
      </p>

      {/* Answer */}
      <div className="px-4 pb-4">
        {isVoice && hasTranscription && (
          <p
            className="text-sm leading-relaxed mb-3"
            style={{ color: "hsl(40 20% 88%)" }}
          >
            {answer.transcription}
          </p>
        )}

        {isVoice && answer.audioUrl && <AudioPlayer url={answer.audioUrl} />}

        {isPhoto && answer.imageUrl && (
          <div className="rounded-xl overflow-hidden">
            <img
              src={answer.imageUrl}
              alt={item.questionText}
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
        )}

        {isVideo && answer.videoUrl && (
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "hsl(225 25% 4%)" }}
          >
            <video
              src={answer.videoUrl}
              controls
              playsInline
              className="w-full h-auto block"
            />
          </div>
        )}

        {isVoice &&
          !hasTranscription &&
          answer.transcriptionStatus === "pending" && (
            <p
              className="text-xs mt-2 italic"
              style={{ color: "hsl(225 10% 35%)" }}
            >
              Transcribing...
            </p>
          )}
      </div>
    </motion.div>
  );
}

// ── Question Group Header ────────────────────────────────────────────────

function QuestionHeader({ text, index }: { text: string; index: number }) {
  return (
    <div className="flex items-center gap-3 pt-4 pb-1">
      <span
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-display font-bold"
        style={{
          background: "hsl(var(--primary) / 0.12)",
          color: "hsl(var(--primary) / 0.7)",
        }}
      >
        {index}
      </span>
      <p
        className="text-xs font-display font-semibold leading-snug"
        style={{ color: "hsl(225 10% 55%)" }}
      >
        {text}
      </p>
    </div>
  );
}

// ── Tab type ────────────────────────────────────────────────────────────

type DashboardTab = "responses" | "members";

// ── Member Row ──────────────────────────────────────────────────────────

function MemberRow({ member }: { member: SurveyMember }) {
  const displayName =
    member.linkedinName ||
    [member.firstName, member.lastName].filter(Boolean).join(" ") ||
    member.phone;
  const initial = (member.firstName || member.linkedinName || member.phone || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-4 py-3"
      style={{
        background: "hsl(225 15% 10%)",
        border: "1px solid hsl(225 15% 14%)",
      }}
    >
      {member.linkedinPhotoUrl ? (
        <img
          src={member.linkedinPhotoUrl}
          alt={displayName}
          className="w-10 h-10 rounded-full object-cover shrink-0"
        />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-display font-bold"
          style={{
            background: "hsl(var(--primary) / 0.15)",
            color: "hsl(var(--primary))",
          }}
        >
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-display font-semibold truncate"
          style={{ color: "hsl(40 20% 95%)" }}
        >
          {displayName}
        </p>
        {member.linkedinEmail && (
          <p
            className="text-xs truncate"
            style={{ color: "hsl(225 10% 45%)" }}
          >
            {member.linkedinEmail}
          </p>
        )}
      </div>
      <span
        className="text-xs shrink-0"
        style={{ color: "hsl(225 10% 35%)" }}
      >
        {formatTimeAgo(member.respondedAt)}
      </span>
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────

export default function AgentDashboard({
  data: initialData,
  dashboardCode,
}: AgentDashboardProps) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortMode>("latest");

  // State hydrated from initial load, then managed incrementally
  const [survey] = useState<DashboardSurvey>(initialData.survey);
  const [questions] = useState<DashboardQuestion[]>(initialData.questions);
  const [responses, setResponses] = useState<DashboardResponse[]>(
    initialData.responses,
  );
  const [total, setTotal] = useState(initialData.total);
  const [hasMore, setHasMore] = useState(initialData.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Tab + Members state ──
  const [activeTab, setActiveTab] = useState<DashboardTab>("responses");
  const [members, setMembers] = useState<SurveyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersFetched, setMembersFetched] = useState(false);

  const handleTabChange = useCallback(async (tab: DashboardTab) => {
    setActiveTab(tab);
    if (tab === "members" && !membersFetched) {
      setMembersLoading(true);
      try {
        const auth = await getDeviceAuth();
        if (!auth?.apiKey) throw new Error("Not authenticated");
        const result = await fetchSurveyMembers(auth.apiKey, survey.id);
        setMembers(result.members);
        setMembersFetched(true);
      } catch {
        // Failed to load members — will show empty state
      } finally {
        setMembersLoading(false);
      }
    }
  }, [membersFetched, survey.id]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const auth = await getDeviceAuth();
      if (!auth?.apiKey) throw new Error("Not authenticated");
      await deleteSurvey(auth.apiKey, survey.id);
      navigate("/", { replace: true });
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Track IDs of responses that arrived via poll (for "new" animation)
  const [newResponseIds, setNewResponseIds] = useState<Set<string>>(new Set());

  // Buffer for new items that arrived while scrolled down
  const [pendingResponses, setPendingResponses] = useState<DashboardResponse[]>([]);

  // Track scroll position to decide whether to buffer or prepend
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearTopRef = useRef(true);

  // Ref to track the latest submittedAt for delta polling
  const latestTimestampRef = useRef<string | null>(
    responses.length > 0 ? responses[0].submittedAt : null,
  );

  // Keep latestTimestampRef in sync when responses change
  useEffect(() => {
    if (responses.length > 0) {
      // Find the most recent submittedAt across all responses
      let latest = responses[0].submittedAt;
      for (const r of responses) {
        if (r.submittedAt && (!latest || r.submittedAt > latest)) {
          latest = r.submittedAt;
        }
      }
      latestTimestampRef.current = latest;
    }
  }, [responses]);

  // ── Track scroll position ──
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      isNearTopRef.current = el.scrollTop < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // ── Flush pending responses (called on pill tap or when user scrolls to top) ──
  const flushPending = useCallback(() => {
    if (pendingResponses.length === 0) return;
    const newIds = new Set(pendingResponses.map((r) => r.id));
    setNewResponseIds(newIds);
    setTimeout(() => setNewResponseIds(new Set()), 2000);
    setResponses((prev) => [...pendingResponses, ...prev]);
    setPendingResponses([]);
    // Scroll to top
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [pendingResponses]);

  // Auto-flush when user scrolls back to top
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || pendingResponses.length === 0) return;
    const onScroll = () => {
      if (el.scrollTop < 20) {
        flushPending();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [pendingResponses, flushPending]);

  // ── Delta polling (every 3s) ──
  useEffect(() => {
    const interval = setInterval(async () => {
      const since = latestTimestampRef.current;
      if (!since) return;

      try {
        const result = await fetchDashboardSince(dashboardCode, since);
        if (result.responses.length > 0) {
          // Deduplicate against both existing and pending
          const existingIds = new Set([
            ...responses.map((r) => r.id),
            ...pendingResponses.map((r) => r.id),
          ]);
          const genuinelyNew = result.responses.filter(
            (r) => !existingIds.has(r.id),
          );

          if (genuinelyNew.length > 0) {
            // Update latestTimestamp so next poll doesn't re-fetch these
            for (const r of genuinelyNew) {
              if (r.submittedAt && (!latestTimestampRef.current || r.submittedAt > latestTimestampRef.current)) {
                latestTimestampRef.current = r.submittedAt;
              }
            }

            if (isNearTopRef.current) {
              // User is at the top — prepend immediately with animation
              const newIds = new Set(genuinelyNew.map((r) => r.id));
              setNewResponseIds(newIds);
              setTimeout(() => setNewResponseIds(new Set()), 2000);
              setResponses((prev) => [...genuinelyNew, ...prev]);
            } else {
              // User is scrolled down — buffer and show pill
              setPendingResponses((prev) => [...genuinelyNew, ...prev]);
            }
          }
          setTotal(result.total);
        }
      } catch {
        // Poll failed silently — will retry next interval
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [dashboardCode, responses, pendingResponses]);

  // ── Infinite scroll: load more ──
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchDashboardPage(
        dashboardCode,
        PAGE_SIZE,
        responses.length,
      );
      if (result.responses.length > 0) {
        // Deduplicate against existing
        const existingIds = new Set(responses.map((r) => r.id));
        const fresh = result.responses.filter((r) => !existingIds.has(r.id));
        setResponses((prev) => [...prev, ...fresh]);
      }
      setHasMore(result.hasMore);
      setTotal(result.total);
    } catch {
      // Failed to load more — user can scroll again to retry
    } finally {
      setLoadingMore(false);
    }
  }, [dashboardCode, responses, loadingMore, hasMore]);

  // ── Scroll sentinel for infinite scroll ──
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // ── Build the feed ──
  const submittedResponses = responses.filter((r) => r.status === "submitted");
  const hasReplies = submittedResponses.length > 0;
  const feed = buildFeed(submittedResponses, questions, sort);

  const surveyTitle = survey.title || "Voice Survey";
  const shareUrl = buildShareUrl(
    survey.title,
    survey.code,
    window.location.origin,
  );

  // For "by-question" mode section headers
  let lastQuestionSort = -1;

  return (
    <div
      className="relative flex flex-col h-full"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Sticky header */}
      <div className="shrink-0 px-5 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="shrink-0 flex items-center justify-center w-9 h-9 -ml-1 rounded-full transition-colors"
            style={{ color: "hsl(225 10% 45%)" }}
            aria-label="Back to home"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "hsl(var(--primary) / 0.15)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"
                stroke="hsl(22, 95%, 62%)"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M19 10v2a7 7 0 0 1-14 0v-2"
                stroke="hsl(22, 95%, 62%)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h1
              className="font-display text-lg font-bold truncate"
              style={{ color: "hsl(40 20% 95%)" }}
            >
              {surveyTitle}
            </h1>
            <p className="text-xs" style={{ color: "hsl(225 10% 40%)" }}>
              {total} {total === 1 ? "reply" : "replies"}
            </p>
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ color: "hsl(225 10% 35%)" }}
            aria-label="Delete survey"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1.5 mb-2">
          {(["responses", "members"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className="px-3 py-1.5 rounded-lg text-xs font-display font-semibold transition-colors"
              style={{
                background:
                  activeTab === tab ? "hsl(225 15% 14%)" : "transparent",
                color:
                  activeTab === tab ? "hsl(40 20% 95%)" : "hsl(225 10% 40%)",
                border:
                  activeTab === tab
                    ? "1px solid hsl(225 15% 20%)"
                    : "1px solid transparent",
              }}
            >
              {tab === "responses" ? "Responses" : "Members"}
            </button>
          ))}
        </div>

        {/* Sort buttons (only for responses tab) */}
        {activeTab === "responses" && hasReplies && (
          <div className="flex gap-1.5">
            {(["latest", "by-question"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSort(mode)}
                className="px-3 py-1.5 rounded-lg text-xs font-display font-semibold transition-colors"
                style={{
                  background:
                    sort === mode ? "hsl(225 15% 14%)" : "transparent",
                  color:
                    sort === mode ? "hsl(40 20% 95%)" : "hsl(225 10% 40%)",
                  border:
                    sort === mode
                      ? "1px solid hsl(225 15% 20%)"
                      : "1px solid transparent",
                }}
              >
                {mode === "latest" ? "Latest" : "By question"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* "New replies" pill — shown when items are buffered */}
      <AnimatePresence>
        {activeTab === "responses" && pendingResponses.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-[140px] left-0 right-0 z-10 flex justify-center pointer-events-none"
          >
            <button
              onClick={flushPending}
              className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full text-xs font-display font-semibold shadow-lg"
              style={{
                background: "hsl(var(--primary))",
                color: "hsl(var(--primary-foreground))",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15" />
              </svg>
              {pendingResponses.length} new {pendingResponses.length === 1 ? "reply" : "replies"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feed / Members */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
        {activeTab === "members" ? (
          /* ── Members tab ── */
          membersLoading ? (
            <div className="flex justify-center py-16">
              <div
                className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
                style={{
                  borderColor: "hsl(22 95% 62%)",
                  borderTopColor: "transparent",
                }}
              />
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                style={{ background: "hsl(225 15% 10%)" }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="hsl(225 10% 30%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <p
                className="text-base font-display font-semibold"
                style={{ color: "hsl(40 20% 95%)" }}
              >
                No members yet
              </p>
              <p
                className="text-sm font-light text-center"
                style={{ color: "hsl(225 10% 45%)" }}
              >
                Members will appear here once people respond to your survey.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => (
                <MemberRow key={member.id} member={member} />
              ))}
            </div>
          )
        ) : !hasReplies ? (
          <div className="flex flex-col items-center justify-center gap-5 py-16">
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                style={{ background: "hsl(225 15% 10%)" }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="hsl(225 10% 30%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p
                className="text-base font-display font-semibold"
                style={{ color: "hsl(40 20% 95%)" }}
              >
                No replies yet
              </p>
              <p
                className="text-sm font-light text-center"
                style={{ color: "hsl(225 10% 45%)" }}
              >
                Share your survey link and replies will appear here in real time.
              </p>
            </div>
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3 w-full"
              style={{ background: "hsl(225 15% 10%)" }}
            >
              <span
                className="text-sm flex-1 truncate font-mono"
                style={{ color: "hsl(40 20% 80%)" }}
              >
                {window.location.host}/s/{survey.code}
              </span>
              <button
                className="text-xs font-display font-semibold shrink-0"
                style={{ color: "hsl(var(--primary))" }}
                onClick={() => navigator.clipboard.writeText(shareUrl)}
              >
                Copy
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {feed.map((item) => {
                // Section headers in "by-question" mode
                let header: React.ReactNode = null;
                if (
                  sort === "by-question" &&
                  item.questionSort !== lastQuestionSort
                ) {
                  lastQuestionSort = item.questionSort;
                  header = (
                    <QuestionHeader
                      key={`qh-${item.questionSort}`}
                      text={item.questionText}
                      index={item.questionSort}
                    />
                  );
                }
                return (
                  <div key={item.id}>
                    {header}
                    <FeedCard
                      item={item}
                      isNew={newResponseIds.has(item.responseId)}
                    />
                  </div>
                );
              })}
            </AnimatePresence>

            {/* Infinite scroll sentinel */}
            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-4">
                {loadingMore ? (
                  <div
                    className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
                    style={{
                      borderColor: "hsl(22 95% 62%)",
                      borderTopColor: "transparent",
                    }}
                  />
                ) : (
                  <p
                    className="text-xs font-display"
                    style={{ color: "hsl(225 10% 30%)" }}
                  >
                    Scroll for more
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Share link at bottom (responses tab only) */}
        {activeTab === "responses" && hasReplies && (
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3 mt-4"
            style={{ background: "hsl(225 15% 10%)" }}
          >
            <span
              className="text-sm flex-1 truncate font-mono"
              style={{ color: "hsl(40 20% 80%)" }}
            >
              {window.location.host}/s/{survey.code}
            </span>
            <button
              className="text-xs font-display font-semibold shrink-0"
              style={{ color: "hsl(var(--primary))" }}
              onClick={() => navigator.clipboard.writeText(shareUrl)}
            >
              Copy
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div
              className="fixed inset-0 z-[80]"
              style={{ background: "rgba(0,0,0,0.6)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !deleting && setShowDeleteConfirm(false)}
            />
            <motion.div
              className="fixed z-[90] left-1/2 top-1/2 w-[min(85vw,320px)] rounded-2xl px-6 py-6"
              style={{
                background: "hsl(225 20% 10%)",
                border: "1px solid hsl(225 15% 16%)",
                transform: "translate(-50%, -50%)",
              }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
            >
              <h3 className="font-display text-base font-bold mb-2" style={{ color: "hsl(40 20% 95%)" }}>
                Delete this survey?
              </h3>
              <p className="text-sm mb-5" style={{ color: "hsl(225 10% 50%)" }}>
                This will remove the survey and its share link. Existing responses will no longer be accessible. This can't be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold"
                  style={{
                    background: "hsl(225 15% 14%)",
                    color: "hsl(40 20% 80%)",
                    border: "1px solid hsl(225 15% 20%)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold"
                  style={{
                    background: "hsl(0 50% 45%)",
                    color: "white",
                  }}
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

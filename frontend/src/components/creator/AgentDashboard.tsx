import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronUp, LoaderCircle, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import VoiceNotePill from "@/components/VoiceNotePill";
import { MOTION, transitionLarge, transitionSmall } from "@/lib/animations";

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

// ── Shared pieces ────────────────────────────────────────────────────────

/** Segmented chip used by the tab switcher and the sort control. */
const chipClass =
  "rounded-full px-s py-xxs text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring";

function chipTone(active: boolean) {
  return active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground";
}

function Spinner() {
  return <LoaderCircle size={24} className="animate-spin text-color-1" aria-hidden />;
}

function ShareLinkRow({ host, code, shareUrl }: { host: string; code: string; shareUrl: string }) {
  return (
    <div className="flex items-center gap-s rounded-s bg-card px-m py-s w-full">
      <span className="flex-1 truncate font-data text-s tabular-nums text-neutral-8">
        {host}/s/{code}
      </span>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="shrink-0 -mr-m"
        onClick={() => navigator.clipboard.writeText(shareUrl)}
      >
        Copy
      </Button>
    </div>
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
      initial={isNew ? { opacity: 0, y: -20 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitionLarge}
      className="rounded-m bg-card overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-s px-m pt-m pb-xs">
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-muted text-xs font-medium text-neutral-8">
          {item.respondentInitial}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-s font-medium text-foreground">
            {item.respondentName}
          </span>
          <span className="text-xs text-muted-foreground ml-xs">
            {formatTimeAgo(item.submittedAt)}
          </span>
        </div>
      </div>

      {/* Question */}
      <p className="px-m pb-xs text-xs text-muted-foreground">
        {item.questionText}
      </p>

      {/* Answer */}
      <div className="px-m pb-m">
        {isVoice && hasTranscription && (
          <p className="text-s text-neutral-8 mb-s">
            {answer.transcription}
          </p>
        )}

        {isVoice && answer.audioUrl && (
          <VoiceNotePill url={answer.audioUrl} durationMs={answer.duration_ms} className="bg-muted" />
        )}

        {isPhoto && answer.imageUrl && (
          <div className="rounded-s overflow-hidden">
            <img
              src={answer.imageUrl}
              alt={item.questionText}
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
        )}

        {isVideo && answer.videoUrl && (
          <div className="rounded-s overflow-hidden bg-background">
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
            <p className="text-xs text-muted-foreground mt-xs italic">
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
    <div className="flex items-center gap-s pt-m pb-xxs">
      <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted font-data text-xxs font-medium text-neutral-8">
        {index}
      </span>
      <p className="text-s font-medium text-neutral-8">
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
    <div className="flex items-center gap-s rounded-m bg-card p-m">
      {member.linkedinPhotoUrl ? (
        <img
          src={member.linkedinPhotoUrl}
          alt={displayName}
          className="w-10 h-10 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-muted text-s font-medium text-neutral-8">
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-s font-medium text-foreground truncate">
          {displayName}
        </p>
        {member.linkedinEmail && (
          <p className="text-xs text-muted-foreground truncate">
            {member.linkedinEmail}
          </p>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
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

  const surveyTitle = survey.title || "Untitled parlo";
  const shareUrl = buildShareUrl(
    survey.title,
    survey.code,
    window.location.origin,
  );

  // For "by-question" mode section headers
  let lastQuestionSort = -1;

  return (
    <div className="relative flex flex-col h-full bg-background">
      {/* Sticky header */}
      <div className="shrink-0 px-l pt-xl pb-m">
        <div className="flex items-center gap-s mb-m">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            aria-label="Back to home"
            className="shrink-0 -ml-xs"
          >
            <ChevronLeft className="!size-6" aria-hidden />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-brand text-l font-heavy text-foreground truncate">
              {surveyTitle}
            </h1>
            <p className="text-xs text-muted-foreground">
              {total} {total === 1 ? "reply" : "replies"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowDeleteConfirm(true)}
            aria-label="Delete parlo"
            className="shrink-0 -mr-xs text-muted-foreground hover:bg-error-transparent hover:text-error"
          >
            <Trash2 aria-hidden />
          </Button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-xs mb-xs">
          {(["responses", "members"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabChange(tab)}
              aria-pressed={activeTab === tab}
              className={`${chipClass} ${chipTone(activeTab === tab)}`}
            >
              {tab === "responses" ? "Responses" : "Members"}
            </button>
          ))}
        </div>

        {/* Sort buttons (only for responses tab) */}
        {activeTab === "responses" && hasReplies && (
          <div className="flex gap-xs">
            {(["latest", "by-question"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSort(mode)}
                aria-pressed={sort === mode}
                className={`${chipClass} ${chipTone(sort === mode)}`}
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
            transition={transitionSmall}
            // top-[140px]: positioned just below the sticky header (structural).
            className="absolute top-[140px] left-0 right-0 z-10 flex justify-center pointer-events-none"
          >
            <Button type="button" size="sm" onClick={flushPending} className="pointer-events-auto shadow-m">
              <ChevronUp aria-hidden />
              {pendingResponses.length} new {pendingResponses.length === 1 ? "reply" : "replies"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feed / Members */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto px-m pb-l">
        {activeTab === "members" ? (
          /* ── Members tab ── */
          membersLoading ? (
            <div className="flex justify-center py-xxl">
              <Spinner />
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-xs py-xxl text-center">
              <p className="text-m font-medium text-foreground">
                No members yet
              </p>
              <p className="text-s text-muted-foreground">
                Members will appear here once people respond to your parlo.
              </p>
            </div>
          ) : (
            <div className="space-y-xs">
              {members.map((member) => (
                <MemberRow key={member.id} member={member} />
              ))}
            </div>
          )
        ) : !hasReplies ? (
          <div className="flex flex-col items-center justify-center gap-l py-xxl">
            <div className="flex flex-col items-center gap-xs text-center">
              <p className="text-m font-medium text-foreground">
                No replies yet
              </p>
              <p className="text-s text-muted-foreground">
                Share your parlo link and replies will appear here in real time.
              </p>
            </div>
            <ShareLinkRow host={window.location.host} code={survey.code} shareUrl={shareUrl} />
          </div>
        ) : (
          <div className="space-y-s">
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
              <div ref={sentinelRef} className="flex justify-center py-m">
                {loadingMore ? (
                  <Spinner />
                ) : (
                  <p className="text-xs text-neutral-6">
                    Scroll for more
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Share link at bottom (responses tab only) */}
        {activeTab === "responses" && hasReplies && (
          <div className="mt-m">
            <ShareLinkRow host={window.location.host} code={survey.code} shareUrl={shareUrl} />
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <>
            <motion.div
              className="fixed inset-0 z-[80] bg-neutral-1-transparent backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transitionSmall}
              onClick={() => !deleting && setShowDeleteConfirm(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-survey-title"
              className="fixed z-[90] left-1/2 top-1/2 w-[min(85vw,320px)] rounded-l bg-card p-l shadow-m"
              // Positioning math: centre the dialog; framer composes this with the scale.
              style={{ x: "-50%", y: "-50%" }}
              initial={{ opacity: 0, scale: MOTION.popupScale }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: MOTION.popupScale }}
              transition={transitionLarge}
            >
              <h3 id="delete-survey-title" className="font-brand text-m font-medium text-foreground mb-xs">
                Delete this parlo?
              </h3>
              <p className="text-s text-muted-foreground mb-l">
                This will remove the parlo and its share link. Existing responses will no longer be accessible. This can't be undone.
              </p>
              <div className="flex gap-s">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="flex-1"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

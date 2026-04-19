import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  fetchNotifications,
  markNotificationsRead,
  type Notification,
  type LinkedInProfile,
} from "@/api/client";
import BottomTabBar from "./BottomTabBar";

interface InboxPageProps {
  apiKey: string;
  linkedInProfile?: LinkedInProfile | null;
  totalNewCount: number;
  onHome: () => void;
  onReels: () => void;
  onCreateNew: () => void;
  onProfile: () => void;
  onOpenSurvey: (surveyId: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  const diffWeek = Math.floor(diffDay / 7);
  return `${diffWeek}w`;
}

function NotificationIcon({ type }: { type: string }) {
  const color = "hsl(22 95% 62%)";

  if (type === "milestone") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    );
  }

  if (type === "featured") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    );
  }

  if (type === "parlo_invite") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    );
  }

  // Default: new_response — speech bubble
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default function InboxPage({
  apiKey,
  linkedInProfile,
  totalNewCount,
  onHome,
  onReels,
  onCreateNew,
  onProfile,
  onOpenSurvey,
}: InboxPageProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetchNotifications(apiKey, { limit: 20 });
      setNotifications(res.notifications);
      setHasMore(res.hasMore);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || notifications.length === 0) return;
    setLoadingMore(true);
    try {
      const lastDate = notifications[notifications.length - 1].createdAt;
      const res = await fetchNotifications(apiKey, { limit: 20, before: lastDate });
      setNotifications((prev) => [...prev, ...res.notifications]);
      setHasMore(res.hasMore);
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false);
    }
  };

  const handleTap = async (notif: Notification) => {
    // Mark as read optimistically
    if (!notif.read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n)),
      );
      markNotificationsRead(apiKey, [notif.id]).catch(() => {
        // Revert on failure
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, read: false } : n)),
        );
      });
    }

    // Navigate if there's a survey
    if (notif.surveyId) {
      onOpenSurvey(notif.surveyId);
    }
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Header */}
      <div className="shrink-0 pt-14 pb-2 px-6">
        <h1
          className="font-display text-xl font-bold"
          style={{ color: "hsl(40 20% 95%)" }}
        >
          Inbox
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex items-center gap-2 opacity-45">
              <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
              <span
                className="text-xs font-display tracking-widest uppercase"
                style={{ color: "hsl(225 10% 55%)" }}
              >
                Loading
              </span>
            </div>
          </div>
        ) : notifications.length === 0 ? (
          <motion.div
            className="flex flex-col items-center justify-center py-20 gap-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "hsl(225 15% 10%)" }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="hsl(225 10% 30%)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <p
              className="text-sm font-display"
              style={{ color: "hsl(225 10% 40%)" }}
            >
              No notifications yet
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2 mt-2">
            {notifications.map((notif, idx) => (
              <motion.button
                key={notif.id}
                onClick={() => handleTap(notif)}
                className="flex items-start gap-3 w-full rounded-2xl px-4 py-4 text-left"
                style={{
                  background: "hsl(225 15% 10%)",
                  border: "1px solid hsl(225 15% 14%)",
                }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03, duration: 0.3 }}
              >
                {/* Unread dot */}
                <div className="flex items-center justify-center w-3 pt-1.5 shrink-0">
                  {!notif.read && (
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: "hsl(22 95% 62%)" }}
                    />
                  )}
                </div>

                {/* Icon */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: "hsl(22 95% 62% / 0.12)" }}
                >
                  <NotificationIcon type={notif.type} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm leading-snug"
                    style={{
                      color: "hsl(40 20% 95%)",
                      fontWeight: notif.read ? 400 : 600,
                    }}
                  >
                    {notif.title}
                  </p>
                  {notif.body && (
                    <p
                      className="text-xs mt-1 leading-relaxed line-clamp-2"
                      style={{ color: "hsl(225 10% 45%)" }}
                    >
                      {notif.body}
                    </p>
                  )}
                </div>

                {/* Time */}
                <span
                  className="text-[11px] font-display shrink-0 pt-0.5"
                  style={{ color: "hsl(225 10% 40%)" }}
                >
                  {timeAgo(notif.createdAt)}
                </span>
              </motion.button>
            ))}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3 text-center text-sm font-display"
                style={{ color: "hsl(22 95% 62%)" }}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>

      <BottomTabBar
        activeTab="content"
        totalNewCount={totalNewCount}
        linkedInProfile={linkedInProfile}
        onHome={onHome}
        onSearch={onReels}
        onCreateNew={onCreateNew}
        onContent={() => {}}
        onProfile={onProfile}
      />
    </div>
  );
}

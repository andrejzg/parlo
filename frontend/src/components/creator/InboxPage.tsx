import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Layers, Mail, MessageSquare, Star } from "lucide-react";
import {
  fetchNotifications,
  markNotificationsRead,
  type Notification,
  type LinkedInProfile,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { transitionLarge } from "@/lib/animations";
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

/** Notification category glyph; colour comes from the parent's text utility. */
function NotificationIcon({ type }: { type: string }) {
  if (type === "milestone") return <Star size={18} aria-hidden />;
  if (type === "featured") return <Layers size={18} aria-hidden />;
  if (type === "parlo_invite") return <Mail size={18} aria-hidden />;
  // Default: new_response — speech bubble
  return <MessageSquare size={18} aria-hidden />;
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
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 pt-xxl pb-xs px-l">
        <h1 className="font-brand text-l font-heavy text-foreground">
          Inbox
        </h1>
      </div>

      {/* Content — pb-24 clears the 72px tab bar plus its safe-area padding */}
      <div className="flex-1 min-h-0 overflow-y-auto px-l pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-xxl">
            <div className="flex items-center gap-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
              <span className="font-brand text-xs font-medium tracking-xl uppercase">
                Loading
              </span>
            </div>
          </div>
        ) : notifications.length === 0 ? (
          <motion.div
            className="flex flex-col items-center justify-center py-xxl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitionLarge}
          >
            <p className="text-s text-muted-foreground">
              No notifications yet
            </p>
          </motion.div>
        ) : (
          <div className="space-y-xs mt-xs">
            {notifications.map((notif, idx) => (
              <motion.button
                key={notif.id}
                onClick={() => handleTap(notif)}
                className="flex items-start gap-s w-full rounded-m bg-card p-m text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...transitionLarge, delay: idx * 0.03 }}
              >
                {/* Unread dot */}
                <div className="flex items-center justify-center w-3 pt-xs shrink-0">
                  {!notif.read && (
                    <div className="w-2 h-2 rounded-full bg-color-1" />
                  )}
                </div>

                {/* Icon */}
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-xxs bg-color-1-transparent text-color-1">
                  <NotificationIcon type={notif.type} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={`text-s text-foreground ${notif.read ? "font-regular" : "font-medium"}`}>
                    {notif.title}
                  </p>
                  {notif.body && (
                    <p className="text-xs text-muted-foreground mt-xxs line-clamp-2">
                      {notif.body}
                    </p>
                  )}
                </div>

                {/* Time */}
                <span className="font-data text-xxs tabular-nums text-muted-foreground shrink-0 pt-xxs">
                  {timeAgo(notif.createdAt)}
                </span>
              </motion.button>
            ))}

            {hasMore && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="w-full"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
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

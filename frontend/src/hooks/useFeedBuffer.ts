import { useState, useRef, useCallback, useEffect } from "react";
import {
  fetchFeed,
  markResponseRead,
  type FeedItem,
  type FeedResponse,
} from "@/api/client";

interface UseFeedBufferOptions {
  apiKey: string;
  surveyId?: string;
  pageSize?: number;
}

interface UseFeedBufferReturn {
  /** All loaded feed items (responses with their answers) */
  items: FeedItem[];
  /** Whether the initial load is in progress */
  loading: boolean;
  /** Whether more items are being loaded (infinite scroll) */
  loadingMore: boolean;
  /** Whether there are more items to load */
  hasMore: boolean;
  /** Total unread count across all surveys */
  totalUnread: number;
  /** Load the next page of items (called when user approaches the end) */
  loadMore: () => Promise<void>;
  /** Mark a response as read (fire-and-forget) */
  markRead: (responseId: string) => void;
  /** Full reload from scratch */
  refresh: () => Promise<void>;
}

interface Cursor {
  before: string;
  beforeId: string;
}

export function useFeedBuffer(options: UseFeedBufferOptions): UseFeedBufferReturn {
  const { apiKey, surveyId, pageSize = 5 } = options;

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalUnread, setTotalUnread] = useState(0);

  const cursorRef = useRef<Cursor | null>(null);
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (cursor: Cursor | null, isInitial: boolean) => {
      try {
        const params: Parameters<typeof fetchFeed>[1] = {
          pageSize,
          unreadOnly: isInitial,
          ...(surveyId && { surveyId }),
          ...(cursor && { before: cursor.before, beforeId: cursor.beforeId }),
        };

        const res: FeedResponse = await fetchFeed(apiKey, params);

        const newItems = res.items;

        setItems((prev) => {
          if (isInitial) return newItems;

          const existingIds = new Set(prev.map((item) => item.response.id));
          const deduped = newItems.filter(
            (item) => !existingIds.has(item.response.id),
          );
          return [...prev, ...deduped];
        });

        setHasMore(res.hasMore);
        setTotalUnread(res.totalUnread);

        // Update cursor from the last item
        if (newItems.length > 0) {
          const last = newItems[newItems.length - 1];
          cursorRef.current = {
            before: last.response.submittedAt,
            beforeId: last.response.id,
          };
        }
      } catch (err) {
        console.warn("[useFeedBuffer] fetch failed:", err);
        if (isInitial) {
          setHasMore(false);
        }
      }
    },
    [apiKey, surveyId, pageSize],
  );

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setItems([]);
      setHasMore(true);
      cursorRef.current = null;

      await fetchPage(null, true);

      if (!cancelled) {
        setLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [apiKey, surveyId, fetchPage]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    await fetchPage(cursorRef.current, false);

    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [hasMore, fetchPage]);

  const markRead = useCallback(
    (responseId: string) => {
      // Optimistic update
      setItems((prev) =>
        prev.map((item) =>
          item.response.id === responseId
            ? { ...item, response: { ...item.response, isRead: true } }
            : item,
        ),
      );
      setTotalUnread((prev) => Math.max(0, prev - 1));

      // Fire-and-forget
      markResponseRead(apiKey, responseId).catch((err) =>
        console.warn("[useFeedBuffer] markRead failed:", err),
      );
    },
    [apiKey],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setItems([]);
    setHasMore(true);
    cursorRef.current = null;

    await fetchPage(null, true);

    setLoading(false);
  }, [fetchPage]);

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    totalUnread,
    loadMore,
    markRead,
    refresh,
  };
}

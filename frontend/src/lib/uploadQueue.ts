// Background upload queue for participant survey flow.
// Manages pending uploads with offline detection, retry, and exponential backoff.

import { uploadAudioBlob } from "@/api/upload";
import { updateAnswerUploadStatus } from "@/lib/sessionStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UploadQueueItem {
  questionId: string;
  blob: Blob;
  uploadUrl: string;
  surveyCode: string;
  retryCount: number;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// UploadQueue
// ---------------------------------------------------------------------------

export class UploadQueue {
  private queue: Map<string, UploadQueueItem> = new Map();
  private inFlight: Map<string, Promise<void>> = new Map();
  private cancelled: Set<string> = new Set();
  private waitResolvers: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  /** Live per-question upload progress (0-100). Cleared on completion/cancel. */
  private progress: Map<string, number> = new Map();
  private listeners: Set<() => void> = new Set();

  private handleOnline = () => this.flush();
  private handleOffline = () => {
    /* uploads naturally stop — nothing to do */
  };

  constructor() {
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
  }

  /**
   * Subscribe to progress / status changes. The callback fires for every
   * progress tick AND for queue state transitions (enqueue, start, finish).
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Current progress (0-100) for a question, or undefined if not uploading. */
  getProgress(questionId: string): number | undefined {
    return this.progress.get(questionId);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // Ignore listener errors — don't let a bad consumer break the queue.
      }
    }
  }

  /** Add an upload to the queue and attempt it immediately if online. */
  enqueue(item: {
    questionId: string;
    blob: Blob;
    uploadUrl: string;
    surveyCode: string;
  }): void {
    // If this questionId was previously cancelled, clear that flag.
    this.cancelled.delete(item.questionId);

    const queueItem: UploadQueueItem = { ...item, retryCount: 0 };
    this.queue.set(item.questionId, queueItem);

    if (navigator.onLine) {
      this.processItem(item.questionId);
    }
  }

  /** Cancel a pending upload for a questionId (e.g. user re-records). */
  cancel(questionId: string): void {
    this.queue.delete(questionId);
    this.cancelled.add(questionId);
    // In-flight uploads can't be aborted, but their result will be ignored.
  }

  /**
   * Returns a promise that resolves when all queued and in-flight uploads
   * complete. Rejects with an error if any uploads have failed status.
   */
  waitForAll(): Promise<void> {
    if (this.queue.size === 0 && this.inFlight.size === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.waitResolvers.push({ resolve, reject });
      // Kick off any items that haven't started yet.
      this.flush();
    });
  }

  /** Number of items still queued (not yet in-flight or completed). */
  getPendingCount(): number {
    return this.queue.size + this.inFlight.size;
  }

  /** Clean up event listeners. */
  destroy(): void {
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    this.queue.clear();
    this.inFlight.clear();
    this.cancelled.clear();
    this.waitResolvers = [];
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private flush(): void {
    for (const questionId of this.queue.keys()) {
      if (!this.inFlight.has(questionId)) {
        this.processItem(questionId);
      }
    }
  }

  private processItem(questionId: string): void {
    const item = this.queue.get(questionId);
    if (!item) return;

    // Move from queue to in-flight.
    this.queue.delete(questionId);

    const promise = this.attemptUpload(item);
    this.inFlight.set(questionId, promise);

    promise.finally(() => {
      this.inFlight.delete(questionId);
      this.settleWaiters();
    });
  }

  private async attemptUpload(item: UploadQueueItem): Promise<void> {
    const { questionId, blob, uploadUrl, surveyCode } = item;

    // Mark uploading in IndexedDB (best-effort, don't block on failure).
    updateAnswerUploadStatus(surveyCode, questionId, "uploading").catch(
      () => {},
    );
    // Live progress starts at 0 for UI consumers.
    this.progress.set(questionId, 0);
    this.notify();

    try {
      await uploadAudioBlob(uploadUrl, blob, (pct) => {
        // XHR fires progress events very frequently; coalesce tiny ticks so
        // the listener storm stays manageable.
        const current = this.progress.get(questionId) ?? 0;
        if (pct - current < 1 && pct < 100) return;
        this.progress.set(questionId, pct);
        this.notify();
      });

      // If cancelled while in-flight, ignore the result.
      if (this.cancelled.has(questionId)) {
        this.cancelled.delete(questionId);
        this.progress.delete(questionId);
        this.notify();
        return;
      }

      this.progress.delete(questionId);
      this.notify();
      await updateAnswerUploadStatus(
        surveyCode,
        questionId,
        "uploaded",
      ).catch(() => {});
    } catch {
      // Cancelled while in-flight — ignore.
      if (this.cancelled.has(questionId)) {
        this.cancelled.delete(questionId);
        this.progress.delete(questionId);
        this.notify();
        return;
      }

      // Offline — put back in queue without incrementing retry count.
      if (!navigator.onLine) {
        this.queue.set(questionId, item);
        this.progress.delete(questionId);
        this.notify();
        updateAnswerUploadStatus(surveyCode, questionId, "pending").catch(
          () => {},
        );
        return;
      }

      // Online error — retry with backoff or fail.
      const nextRetry = item.retryCount + 1;
      if (nextRetry > MAX_RETRIES) {
        this.progress.delete(questionId);
        this.notify();
        updateAnswerUploadStatus(surveyCode, questionId, "failed").catch(
          () => {},
        );
        return;
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, item.retryCount);
      await this.delay(delayMs);

      // Check cancelled / offline again after waiting.
      if (this.cancelled.has(questionId)) {
        this.cancelled.delete(questionId);
        return;
      }
      if (!navigator.onLine) {
        this.queue.set(questionId, { ...item, retryCount: nextRetry });
        return;
      }

      // Re-enqueue internally for the retry attempt.
      const retryItem: UploadQueueItem = { ...item, retryCount: nextRetry };
      this.queue.set(questionId, retryItem);
      this.processItem(questionId);
    }
  }

  private settleWaiters(): void {
    if (this.queue.size > 0 || this.inFlight.size > 0) return;

    const resolvers = this.waitResolvers;
    this.waitResolvers = [];
    for (const { resolve } of resolvers) {
      resolve();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const uploadQueue = new UploadQueue();

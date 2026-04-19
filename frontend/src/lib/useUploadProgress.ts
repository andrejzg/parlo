import { useEffect, useState } from "react";
import { uploadQueue } from "@/lib/uploadQueue";

/**
 * Subscribe to live upload progress for a single question. Returns the
 * current progress percentage (0-100) if the answer is currently uploading,
 * or `undefined` if it's idle (never started, already finished, or failed).
 *
 * Used by ReviewScreen / ThankYouScreen to render a thin progress bar on
 * video answers while their background upload runs. Safe to call in any
 * component — subscribes on mount, unsubscribes on unmount.
 */
export function useUploadProgress(questionId: string): number | undefined {
  const [pct, setPct] = useState<number | undefined>(() =>
    uploadQueue.getProgress(questionId),
  );

  useEffect(() => {
    const update = () => setPct(uploadQueue.getProgress(questionId));
    update();
    return uploadQueue.subscribe(update);
  }, [questionId]);

  return pct;
}

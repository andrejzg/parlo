import { useEffect, useRef, useState } from "react";
import type { ProbeResult } from "@/api/client";
import { trackEvent } from "@/lib/posthog";

/**
 * Sends one clip of an answer to the agent's judge (`probeAnswer`, wired by
 * the page, which holds the response session). Null = nothing was asked
 * (no session yet).
 */
export type ProbeFn = (input: { blob: Blob; transcriptSoFar?: string }) => Promise<ProbeResult | null>;

export interface FollowUp {
  text: string;
  /** 1 for the first follow-up shown on this question, 2 for the second. */
  n: number;
}

/**
 * Probing on one question screen (a study's voice questions only): the agent
 * hears each take as it is recorded and may ask one short follow-up, which
 * the participant answers with a further clip of the same answer.
 *
 * Everything lives in this screen and nowhere else: `followUp` is the one on
 * the table (React state, it drives the card), the rest is a ref. Nothing is
 * stored, so leaving the question or reloading the page forgets it; the
 * server keeps the follow-ups it asked and enforces how many there may be.
 *
 * `onShown` is called with each follow-up as it goes on screen.
 *
 * Without `probe` every method is a no-op and `pending()` is always null.
 */
export function useAnswerProbe(questionId: string, probe?: ProbeFn, onShown?: (text: string) => void) {
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const s = useRef({
    /** Bumped when the answer is recorded again from scratch: a verdict on an older take is dropped. */
    take: 0,
    /** Everything the judge has heard of this take; goes back as `transcriptSoFar` with the next clip. */
    transcript: "",
    /** Follow-ups shown on this screen so far. Not reset by a re-record: the server's count is not either. */
    shown: 0,
    /** A follow-up is on the table: the next clip recorded is its answer. */
    awaiting: false,
    /** The call for the latest clip, while it is in flight. */
    pending: null as Promise<FollowUp | null> | null,
    /** The participant has moved on: a late verdict must not put a card on a screen that is leaving. */
    left: false,
  }).current;

  useEffect(() => {
    s.left = false;
    return () => {
      s.left = true;
    };
  }, [s]);

  const send = (blob: Blob, transcriptSoFar?: string): Promise<FollowUp | null> | null => {
    if (!probe || blob.size === 0) return null;
    const take = s.take;
    s.awaiting = false;
    const call: Promise<FollowUp | null> = probe({ blob, transcriptSoFar })
      .catch(() => null)
      .then((result) => {
        if (s.pending === call) s.pending = null;
        if (!result || take !== s.take || s.left) return null;
        if (result.transcript) s.transcript = result.transcript;
        const text = result.probe?.text?.trim();
        if (!text) return null;
        s.shown += 1;
        s.awaiting = true;
        const next: FollowUp = { text, n: s.shown };
        setFollowUp(next);
        // The server counts and keeps only the follow-ups it is told were seen.
        onShown?.(text);
        trackEvent("probe_shown", { questionId, n: next.n });
        return next;
      });
    s.pending = call;
    return call;
  };

  const forget = () => {
    s.take += 1;
    s.transcript = "";
    s.awaiting = false;
    s.pending = null;
    setFollowUp(null);
  };

  return {
    enabled: !!probe,
    /** The follow-up on the table, or null. */
    followUp,
    /**
     * A fresh take of the whole answer (the first one, or a re-record): judged
     * on its own. Resolves to the follow-up it brought, or null.
     */
    heardTake: (blob: Blob) => {
      forget();
      return send(blob);
    },
    /**
     * A further clip. Judged, together with what was heard before, only when
     * it answers a follow-up; a clip added for any other reason is not sent.
     */
    heardClip: (blob: Blob) => {
      if (!s.awaiting || blob.size === 0) return null;
      setFollowUp(null);
      return send(blob, s.transcript || undefined);
    },
    /** The call for the latest clip if it has not come back yet. */
    pending: () => s.pending,
    /** "Answer" was tapped. */
    answering: () => {
      if (followUp) trackEvent("probe_answer_started", { questionId, n: followUp.n });
    },
    /** "Skip", or Next while the follow-up is showing: it goes away and nothing more is asked of this take. */
    skip: () => {
      if (!followUp) return;
      trackEvent("probe_skipped", { questionId, n: followUp.n });
      s.awaiting = false;
      setFollowUp(null);
    },
    /** The answer is being recorded again from scratch. */
    reset: forget,
    /** The participant is leaving this question. */
    leave: () => {
      s.left = true;
    },
  };
}

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { apiErrorMessage, claimMyReward, fetchMyRewards, formatMoney, type MyReward } from "@/api/study";
import { trackEvent } from "@/lib/posthog";
import { fadeUp } from "@/lib/animations";

interface RewardCardProps {
  code: string;
  /** The member token from the personal link. Without one there is nobody to pay. */
  token: string | null;
}

/** How often to look again while a reward is still being prepared. */
const POLL_MS = 4000;
/** Stop looking after this long; the card then shows the last known state. */
const POLL_WINDOW_MS = 2 * 60 * 1000;
/** How long the claim button waits for the browser to leave before it can be tapped again. */
const LEAVING_TIMEOUT_MS = 15 * 1000;

const CLAIM_FAILED = "Couldn't open your reward. Try again in a minute.";

/** `apiFetch` throws "API <status>: <body>" for an answer that was not ok. */
function isApiError(err: unknown): err is Error {
  return err instanceof Error && /^API \d+:/.test(err.message);
}

/** A 4xx means the link is not a member's (or the parlo is gone): asking again will not help. */
function isClientError(err: unknown): boolean {
  return err instanceof Error && /^API 4\d\d:/.test(err.message);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * What this member has been paid for answering, newest first: on its way,
 * ready to claim, or with the research team for a look. Renders nothing for
 * a visitor without a member token or a member with no rewards.
 */
export default function RewardCard({ code, token }: RewardCardProps) {
  const [rewards, setRewards] = useState<MyReward[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  // Bumped to load again after the browser brings this page back from its
  // back/forward cache (the participant returning from the redemption page).
  const [epoch, setEpoch] = useState(0);
  const shownRef = useRef(false);
  const leavingTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!code || !token) {
      setRewards([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const withinWindow = () => Date.now() - startedAt < POLL_WINDOW_MS;

    const load = async () => {
      try {
        const data = await fetchMyRewards(code, token);
        if (cancelled) return;
        // The server sends them newest first.
        const list = Array.isArray(data?.rewards) ? data.rewards : [];
        setRewards(list);
        if (list.some((r) => r.state === "preparing") && withinWindow()) {
          timer = setTimeout(load, POLL_MS);
        }
      } catch (err) {
        // Keep whatever is on screen. A network blip is worth another try.
        if (cancelled || isClientError(err) || !withinWindow()) return;
        timer = setTimeout(load, POLL_MS);
      }
    };
    load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, token, epoch]);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      clearTimeout(leavingTimer.current);
      setClaimingId(null);
      setEpoch((n) => n + 1);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      clearTimeout(leavingTimer.current);
    };
  }, []);

  const newest = rewards[0];

  useEffect(() => {
    if (!newest || shownRef.current) return;
    shownRef.current = true;
    trackEvent("reward_card_shown", { state: newest.state, amountCents: newest.amountCents, surveyCode: code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.id]);

  if (!token || !newest) return null;

  const handleClaim = async (reward: MyReward) => {
    if (!token || claimingId) return;
    trackEvent("reward_claim_tapped", { amountCents: reward.amountCents, surveyCode: code, again: reward.claimed });
    setClaimingId(reward.id);
    try {
      // The link is a bearer secret: it lives in this call only. It is never
      // kept in state or storage, never logged, never sent to analytics.
      const { url } = await claimMyReward(code, token, reward.id);
      if (isHttpsUrl(url)) {
        window.location.assign(url);
        // The button stays busy while the browser leaves the page. If it never does, free it.
        clearTimeout(leavingTimer.current);
        leavingTimer.current = setTimeout(() => setClaimingId(null), LEAVING_TIMEOUT_MS);
        return;
      }
      toast(CLAIM_FAILED);
    } catch (err) {
      // The server's own sentence when it sent one; never a raw network error.
      toast(isApiError(err) ? apiErrorMessage(err, CLAIM_FAILED) : CLAIM_FAILED);
    }
    setClaimingId(null);
    // What is on screen may be out of date (not ready yet, cancelled): look again.
    setEpoch((n) => n + 1);
  };

  return (
    <motion.div
      className="w-full shrink-0 flex flex-col gap-s text-left"
      variants={fadeUp}
      initial="initial"
      animate="animate"
      aria-live="polite"
      data-testid="reward-card"
      data-state={newest.state}
    >
      {rewards.map((reward) => {
        const amount = formatMoney(reward.amountCents, reward.currency);
        const busy = claimingId === reward.id;
        return (
          <div
            key={reward.id}
            className="rounded-m bg-card p-m flex flex-col gap-s"
            data-testid="reward-row"
            data-state={reward.state}
            data-claimed={reward.claimed}
          >
            {reward.state === "preparing" ? (
              <div className="flex items-center gap-s">
                <LoaderCircle size={16} className="shrink-0 animate-spin text-muted-foreground" aria-hidden />
                <p className="text-s font-medium text-foreground">Your {amount} thank-you is on its way</p>
              </div>
            ) : reward.state === "review" ? (
              <p className="text-s text-neutral-8">
                <span className="font-medium text-foreground">
                  Your {amount} thank-you is with the research team for a quick look.
                </span>{" "}
                It will show here.
              </p>
            ) : reward.claimed ? (
              <>
                <p className="text-s font-medium text-foreground">Your {amount} thank-you</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => handleClaim(reward)}
                  disabled={claimingId !== null}
                  data-testid="reward-reopen"
                >
                  {busy && <LoaderCircle className="animate-spin" aria-hidden />}
                  Open it again
                </Button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-xxs">
                  <h2 className="text-s font-medium text-foreground">Your {amount} thank-you is ready</h2>
                  <p className="text-s text-neutral-8">
                    Pick how you'd like it: a gift card, PayPal, a bank transfer or a donation.
                  </p>
                </div>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => handleClaim(reward)}
                  disabled={claimingId !== null}
                  data-testid="reward-claim"
                >
                  {busy && <LoaderCircle className="animate-spin" aria-hidden />}
                  Claim {amount}
                </Button>
              </>
            )}
          </div>
        );
      })}
    </motion.div>
  );
}

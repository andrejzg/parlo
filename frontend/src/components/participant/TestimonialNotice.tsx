import { useEffect } from "react";
import { formatMoney } from "@/api/study";

/** What the notice says when the parlo sent none of its own. */
const FALLBACK_NOTICE = "This recording may be used in public marketing material.";

interface TestimonialNoticeProps {
  /** Who may use the recording (`Survey.testimonialNotice`). */
  notice?: string;
  /** What recording it pays, in cents (`SurveyQuestion.rewardCents`). */
  rewardCents?: number;
  currency?: string;
  /** Called once the notice is on screen: the page tells the server which asks were shown with it. */
  onShown?: () => void;
}

/**
 * A testimonial ask (`question.purpose === "testimonial"`): a line meant for
 * public use. This sits above the recording control and says who may use the
 * recording before anything is recorded. Recording under it is the consent,
 * so the wording here is the wording the participant agreed to.
 */
export default function TestimonialNotice({ notice, rewardCents, currency, onShown }: TestimonialNoticeProps) {
  useEffect(() => {
    onShown?.();
    // Once per time the notice appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full rounded-m bg-card p-m flex flex-col gap-xs text-left" data-testid="testimonial-notice">
      <div className="flex items-center justify-between gap-s">
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">For public use</span>
        {rewardCents ? (
          <span
            className="inline-flex items-center whitespace-nowrap rounded-full bg-color-1-transparent px-s py-xxs text-xs font-medium text-color-1"
            data-testid="testimonial-bonus"
          >
            {formatMoney(rewardCents, currency ?? "USD")} bonus
          </span>
        ) : null}
      </div>
      <p className="text-s text-neutral-8">
        <span className="text-foreground">{notice?.trim() || FALLBACK_NOTICE}</span>
        {" Recording it is your OK. Say it in your own words, one or two sentences."}
      </p>
    </div>
  );
}

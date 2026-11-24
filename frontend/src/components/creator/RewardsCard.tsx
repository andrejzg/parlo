import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Banknote, LoaderCircle } from "lucide-react";
import {
  apiErrorMessage,
  fetchRewards,
  formatMoney,
  releaseReward,
  updateRewardSettings,
  voidReward,
  type LedgerReward,
  type RewardStatus,
  type RewardSummary,
} from "@/api/study";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { MoneyInput } from "@/components/creator/MoneyInput";
import { centsToDollars, dollarsToCents } from "@/components/creator/studyUi";
import { transitionSmall } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";

interface RewardsCardProps {
  apiKey: string;
  surveyId: string;
  /** The study's currency once it is known, so round prices carry the same sign. */
  onCurrency?: (currency: string) => void;
  /** The budget or a reward changed: whatever is priced against the budget should reload. */
  onChanged?: () => void;
}

const POLL_MS = 10_000;

/** Why a reward is waiting for a person, in words. */
function reasonFor(reward: LedgerReward): string {
  if (reward.status === "failed") return reward.error || "The payout didn't go through";
  switch (reward.holdReason) {
    case "too_short":
      return "The answer was only a few words";
    case "off_topic":
      return "The answer didn't speak to the question";
    case "over_budget":
      return "Would take the study over budget";
    default:
      return "Held for a look";
  }
}

function statusWord(reward: LedgerReward): string {
  switch (reward.status) {
    case "pending":
      return "Waiting for transcript";
    case "approved":
      return "Owed";
    case "sent":
      return reward.claimedAt ? "Claimed" : "Sent";
    case "held":
      return "Held";
    case "failed":
      return "Failed";
    case "void":
      return "Not paid";
    default:
      return reward.status;
  }
}

function Stat({ label, value, tone = "text-foreground", testId }: { label: string; value: string; tone?: string; testId: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className={`font-data tabular-nums text-m font-medium ${tone}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * What the study pays participants: the budget, what has gone out, and the
 * rewards the checks held back for a person to decide.
 */
export default function RewardsCard({ apiKey, surveyId, onCurrency, onChanged }: RewardsCardProps) {
  const [summary, setSummary] = useState<RewardSummary | null>(null);
  const [rewards, setRewards] = useState<LedgerReward[]>([]);
  const [failed, setFailed] = useState(false);
  // null = untouched: the field shows what the server has, and a poll may refresh it.
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [defaultDraft, setDefaultDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetchRewards(apiKey, surveyId);
      setSummary(r.summary);
      setRewards(r.rewards);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [apiKey, surveyId]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const currency = summary?.currency;
  useEffect(() => {
    if (currency) onCurrency?.(currency);
  }, [currency, onCurrency]);

  const header = (
    <div className="flex items-center gap-s">
      <Banknote size={16} className="text-muted-foreground shrink-0" aria-hidden />
      <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">Rewards</p>
    </div>
  );

  if (!summary) {
    return (
      <div className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="rewards-card">
        {header}
        {failed ? (
          <p className="text-s text-muted-foreground">Couldn't load rewards.</p>
        ) : (
          <LoaderCircle size={16} className="animate-spin text-color-1" aria-hidden />
        )}
      </div>
    );
  }

  const money = (cents: number) => formatMoney(cents, summary.currency);

  const budgetValue = budgetDraft ?? centsToDollars(summary.budgetCents);
  const defaultValue = defaultDraft ?? centsToDollars(summary.defaultCents || null);
  const budgetCents = dollarsToCents(budgetValue);
  // A default of zero is no default.
  const defaultCents = dollarsToCents(defaultValue) || null;
  const dirty = budgetCents !== summary.budgetCents || defaultCents !== (summary.defaultCents || null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const r = await updateRewardSettings(apiKey, surveyId, { budgetCents, defaultCents });
      setSummary(r.summary);
      setBudgetDraft(null);
      setDefaultDraft(null);
      trackEvent("reward_settings_saved", { surveyId, budgetCents, defaultCents });
      toast.success("Saved.");
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't save that."));
    } finally {
      setSaving(false);
    }
  };

  const applyOutcome = (rewardId: string, status: RewardStatus, error: string | null, next: RewardSummary) => {
    setSummary(next);
    setRewards((prev) => prev.map((r) => (r.id === rewardId ? { ...r, status, error } : r)));
    onChanged?.();
    load();
  };

  const handleRelease = async (reward: LedgerReward) => {
    setBusyId(reward.id);
    try {
      const r = await releaseReward(apiKey, surveyId, reward.id);
      trackEvent("reward_released", { surveyId, rewardId: reward.id, amountCents: reward.amountCents, status: r.status });
      if (r.status === "failed") toast.error(r.error || "The payout didn't go through.");
      else toast.success(r.status === "sent" ? "Reward sent." : "Reward approved. It is owed now.");
      applyOutcome(reward.id, r.status, r.error, r.summary);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't pay that reward."));
    } finally {
      setBusyId(null);
    }
  };

  const handleVoid = async (reward: LedgerReward) => {
    setBusyId(reward.id);
    try {
      const r = await voidReward(apiKey, surveyId, reward.id);
      trackEvent("reward_voided", { surveyId, rewardId: reward.id, amountCents: reward.amountCents, was: reward.status });
      toast.success("Marked as not paid.");
      applyOutcome(reward.id, r.status, null, r.summary);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't change that reward."));
    } finally {
      setBusyId(null);
    }
  };

  const needsLook = rewards.filter((r) => r.status === "held" || r.status === "failed");
  const overCap = summary.remainingCents !== null && summary.remainingCents < 0;

  return (
    <div className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="rewards-card">
      {header}

      {summary.payouts === null && (
        <p className="rounded-s bg-warning-transparent px-s py-xs text-xs text-foreground" data-testid="rewards-payouts" data-mode="none">
          Payouts aren't connected yet. Rewards are recorded and wait as owed.
        </p>
      )}
      {summary.payouts === "sandbox" && (
        <p className="text-xs text-muted-foreground" data-testid="rewards-payouts" data-mode="sandbox">
          Sandbox payouts: no real money moves.
        </p>
      )}

      <div className="grid grid-cols-3 gap-s">
        <Stat label="Paid out" value={money(summary.sentCents)} testId="rewards-paid" />
        <Stat label="Owed" value={money(summary.owedCents)} testId="rewards-owed" />
        <Stat
          label="Left"
          value={summary.remainingCents === null ? "No cap" : money(summary.remainingCents)}
          tone={overCap ? "text-error" : "text-foreground"}
          testId="rewards-left"
        />
      </div>

      <form onSubmit={handleSave} data-testid="rewards-settings">
        <div className="flex flex-col gap-xs">
          <div className="flex items-center gap-s">
            <Label htmlFor="reward-budget" className="flex-1">
              Budget for this study
            </Label>
            <MoneyInput
              id="reward-budget"
              currency={summary.currency}
              value={budgetValue}
              onValueChange={setBudgetDraft}
              className="w-28 shrink-0"
              disabled={saving}
              data-testid="rewards-budget-input"
            />
          </div>
          <div className="flex items-center gap-s">
            <Label htmlFor="reward-default" className="flex-1">
              Default reward per answer
            </Label>
            <MoneyInput
              id="reward-default"
              currency={summary.currency}
              value={defaultValue}
              onValueChange={setDefaultDraft}
              className="w-28 shrink-0"
              disabled={saving}
              data-testid="rewards-default-input"
            />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {dirty && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={transitionSmall}
              // The negative margin and inner padding leave room for the button's focus outline.
              className="overflow-hidden -mx-xxs"
            >
              <div className="px-xxs pt-s pb-xxs">
                <Button type="submit" size="sm" className="w-full" disabled={saving} data-testid="rewards-save">
                  {saving && <LoaderCircle className="animate-spin" aria-hidden />}
                  {saving ? "Saving" : "Save"}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>

      {needsLook.length > 0 && (
        <div className="flex flex-col gap-xs" data-testid="rewards-needs-look">
          <p className="text-s font-medium text-foreground">Needs a look</p>
          <ul className="flex flex-col gap-xs">
            {needsLook.map((reward) => (
              <li key={reward.id} className="rounded-s bg-muted px-s py-s flex flex-col gap-xs" data-testid="reward-review" data-status={reward.status}>
                <div className="min-w-0">
                  <p className="text-s text-foreground">
                    {reward.name || "Participant"}
                    {reward.segment && <span className="text-muted-foreground"> · {reward.segment}</span>}
                  </p>
                  <p className="font-data tabular-nums text-xs text-muted-foreground">
                    Round {reward.roundNumber} · {formatMoney(reward.amountCents, reward.currency)}
                  </p>
                  <p className={`text-xs ${reward.status === "failed" ? "text-error" : "text-neutral-8"}`}>{reasonFor(reward)}</p>
                </div>
                <div className="flex gap-xs">
                  <Button type="button" size="sm" variant="secondary" className="flex-1" onClick={() => handleVoid(reward)} disabled={busyId !== null} data-testid="reward-void">
                    Don't pay
                  </Button>
                  <Button type="button" size="sm" className="flex-1" onClick={() => handleRelease(reward)} disabled={busyId !== null} data-testid="reward-release">
                    {busyId === reward.id && <LoaderCircle className="animate-spin" aria-hidden />}
                    Pay it
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rewards.length > 0 && (
        <div className="flex flex-col">
          <button
            type="button"
            className="flex items-center justify-between text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring rounded-xs"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            data-testid="rewards-all-toggle"
          >
            <span className="text-s font-medium text-foreground">All rewards ({rewards.length})</span>
            <span className="text-xs text-muted-foreground">{showAll ? "Hide" : "Show"}</span>
          </button>
          <AnimatePresence initial={false}>
            {showAll && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={transitionSmall}
                className="overflow-hidden"
              >
                <ul className="flex flex-col pt-xs" data-testid="rewards-all">
                  {rewards.map((reward) => (
                    <li key={reward.id} className="flex items-center justify-between gap-s py-xs" data-testid="reward-row" data-status={reward.status}>
                      <div className="min-w-0">
                        <p className="text-s text-foreground truncate">{reward.name || "Participant"}</p>
                        <p className="text-xs text-muted-foreground">Round {reward.roundNumber}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-data tabular-nums text-s text-foreground">{formatMoney(reward.amountCents, reward.currency)}</p>
                        <p className={`text-xs ${reward.status === "failed" ? "text-error" : "text-muted-foreground"}`}>{statusWord(reward)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

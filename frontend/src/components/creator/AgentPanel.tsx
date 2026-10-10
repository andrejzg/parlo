import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Check, FileText, LoaderCircle, RefreshCw, Send, Sparkles, X } from "lucide-react";
import {
  approveRound,
  fetchAgent,
  proposeRound,
  rejectRound,
  runAgentDigest,
  updateGroupSettings,
  type AgentSnapshot,
  type GroupRound,
  type GroupVisibility,
  type RoundKind,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "@/lib/markdown";
import { visibilityCopy } from "@/lib/visibility";
import { transitionLarge, transitionSmall } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";
import { toast } from "@/components/ui/sonner";

interface AgentPanelProps {
  apiKey: string;
  surveyId: string;
  /** Called when the owner flips visibility so the parent can refresh. */
  onVisibilityChange?: (visibility: GroupVisibility) => void;
}

const POLL_MS = 6000;

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function kindLabel(kind: RoundKind) {
  return kind === "probe" ? "Probe · personal follow-ups" : "Poll · same ask for everyone";
}

function RoundCard({
  round,
  busy,
  onApprove,
  onReject,
}: {
  round: GroupRound;
  busy: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const proposed = round.status === "proposed";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionLarge}
      className={`rounded-m p-m flex flex-col gap-s ${proposed ? "bg-card shadow-edge-accent" : "bg-card"}`}
      data-testid={`round-${round.number}`}
      data-status={round.status}
    >
      <div className="flex items-center justify-between gap-s">
        <div className="min-w-0">
          <p className="text-s font-medium text-foreground">
            Round {round.number}
            <span className="text-muted-foreground font-regular"> · {kindLabel(round.kind)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {round.status === "proposed"
              ? "Waiting for your approval"
              : round.status === "sent"
              ? `Sent ${formatWhen(round.sent_at)}`
              : round.status}
          </p>
        </div>
        {proposed && (
          <span className="shrink-0 inline-flex items-center rounded-full bg-badge text-badge-foreground px-s py-xxs font-brand text-xxs font-medium tracking-xl uppercase">
            New
          </span>
        )}
      </div>

      {round.rationale && <p className="text-s text-neutral-8">{round.rationale}</p>}

      <ul className="flex flex-col gap-xs">
        {round.asks.map((ask) => (
          <li key={ask.id} className="rounded-s bg-muted px-s py-xs">
            <p className="text-s text-foreground">{ask.text}</p>
            <p className="text-xs text-muted-foreground mt-xxs">
              {ask.targetName ? `For ${ask.targetName}` : "For everyone"}
              {ask.hint ? ` · ${ask.hint}` : ""}
            </p>
          </li>
        ))}
      </ul>

      {proposed && (
        <div className="flex gap-s pt-xxs">
          <Button type="button" variant="secondary" className="flex-1" onClick={onReject} disabled={busy}>
            <X aria-hidden />
            Not now
          </Button>
          <Button type="button" className="flex-1" onClick={onApprove} disabled={busy} data-testid="round-approve">
            <Send aria-hidden />
            Send round
          </Button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * The owner's window into the group agent: the report it keeps for the
 * group, the rounds it has proposed, and the open-group switch.
 */
export default function AgentPanel({ apiKey, surveyId, onVisibilityChange }: AgentPanelProps) {
  const [snap, setSnap] = useState<AgentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [digesting, setDigesting] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [acting, setActing] = useState(false);
  const [showMemory, setShowMemory] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await fetchAgent(apiKey, surveyId);
      setSnap(s);
    } catch {
      // keep whatever we had
    } finally {
      setLoading(false);
    }
  }, [apiKey, surveyId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const handleDigest = async () => {
    setDigesting(true);
    trackEvent("agent_digest_clicked", { surveyId });
    try {
      const r = await runAgentDigest(apiKey, surveyId);
      if (!r.ok) toast.error(r.error ?? "The agent couldn't update the report.");
      else if (r.answersRead === 0) toast("No answers yet — the report appears once people respond.");
      else toast.success("Report updated.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The agent couldn't update the report.");
    } finally {
      setDigesting(false);
    }
  };

  const handlePropose = async (kind?: RoundKind) => {
    setProposing(true);
    trackEvent("agent_propose_clicked", { surveyId, kind: kind ?? "auto" });
    try {
      await proposeRound(apiKey, surveyId, kind ? { kind } : {});
      toast.success("The agent proposed a round. Review it below.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The agent couldn't plan a round.");
    } finally {
      setProposing(false);
    }
  };

  const handleApprove = async (round: GroupRound) => {
    setActing(true);
    try {
      const r = await approveRound(apiKey, surveyId, round.id);
      toast.success(r.notified > 0 ? `Round ${round.number} sent to ${r.notified} ${r.notified === 1 ? "person" : "people"}.` : `Round ${round.number} is open.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the round.");
    } finally {
      setActing(false);
    }
  };

  const handleReject = async (round: GroupRound) => {
    setActing(true);
    try {
      await rejectRound(apiKey, surveyId, round.id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't dismiss the round.");
    } finally {
      setActing(false);
    }
  };

  const handleVisibility = async (open: boolean) => {
    const visibility: GroupVisibility = open ? "open" : "private";
    setSnap((prev) => (prev ? { ...prev, visibility } : prev));
    try {
      await updateGroupSettings(apiKey, surveyId, { visibility });
      onVisibilityChange?.(visibility);
      trackEvent("group_visibility_toggled", { surveyId, visibility });
    } catch {
      toast.error("Couldn't change the group's visibility.");
      await load();
    }
  };

  if (loading && !snap) {
    return (
      <div className="flex justify-center py-xxl">
        <LoaderCircle size={24} className="animate-spin text-color-1" aria-hidden />
      </div>
    );
  }
  if (!snap) {
    return <p className="text-s text-muted-foreground text-center py-xxl">Couldn't reach the agent.</p>;
  }

  const proposed = snap.rounds.filter((r) => r.status === "proposed");
  const sent = snap.rounds.filter((r) => r.status === "sent").sort((a, b) => b.number - a.number);
  const vis = visibilityCopy(snap.visibility);
  const answersOnFile = snap.files.filter((f) => f.path.startsWith("/answers/")).length;

  return (
    <div className="flex flex-col gap-m" data-testid="agent-panel">
      {/* Status */}
      <div className="rounded-m bg-card p-m flex items-center gap-s">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-color-1-transparent text-color-1">
          <Bot size={20} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-s font-medium text-foreground">Your agent</p>
          <p className="text-xs text-muted-foreground truncate">
            {answersOnFile} answer{answersOnFile === 1 ? "" : "s"} on file · report {formatWhen(snap.reportUpdatedAt)}
            {snap.state.lastError ? " · last run failed" : ""}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={handleDigest} disabled={digesting} aria-label="Update the report">
          {digesting ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          {digesting ? "Thinking" : "Update"}
        </Button>
      </div>

      {/* Proposed rounds */}
      <AnimatePresence initial={false}>
        {proposed.map((round) => (
          <RoundCard key={round.id} round={round} busy={acting} onApprove={() => handleApprove(round)} onReject={() => handleReject(round)} />
        ))}
      </AnimatePresence>

      {proposed.length === 0 && (
        <div className="rounded-m bg-card p-m flex flex-col gap-s">
          <div className="flex items-center gap-s">
            <Sparkles size={16} className="text-color-1 shrink-0" aria-hidden />
            <p className="text-s font-medium text-foreground">Next round</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Ask the agent to plan the next round. You approve before anything goes out.
          </p>
          <div className="flex gap-s">
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => handlePropose("poll")} disabled={proposing || answersOnFile === 0}>
              Poll everyone
            </Button>
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => handlePropose("probe")} disabled={proposing || answersOnFile === 0}>
              Follow up 1:1
            </Button>
            <Button type="button" size="sm" className="flex-1" onClick={() => handlePropose()} disabled={proposing || answersOnFile === 0} data-testid="agent-propose">
              {proposing ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
              {proposing ? "Planning" : "Let it pick"}
            </Button>
          </div>
          {answersOnFile === 0 && <p className="text-xxs text-muted-foreground">Available once someone has answered.</p>}
        </div>
      )}

      {/* Report */}
      <div className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="agent-report">
        <div className="flex items-center gap-s">
          <FileText size={16} className="text-muted-foreground shrink-0" aria-hidden />
          <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">The report members see</p>
        </div>
        {snap.report ? (
          <Markdown source={snap.report} />
        ) : (
          <p className="text-s text-muted-foreground">
            Nothing yet. A few minutes after the first answers land, the agent writes the first report and keeps it current as more arrive.
          </p>
        )}
      </div>

      {/* Visibility */}
      <div className="flex items-center gap-s rounded-m bg-card p-m">
        <div className="flex-1 flex flex-col gap-xxs">
          <Label htmlFor="open-group">{vis.label === "Open group" ? "Open group" : "Open group"}</Label>
          <p className="text-xs text-muted-foreground">{vis.settingDescription}</p>
        </div>
        <Switch id="open-group" checked={snap.visibility === "open"} onCheckedChange={handleVisibility} data-testid="open-group-switch" />
      </div>

      {/* Sent rounds */}
      {sent.length > 0 && (
        <div className="flex flex-col gap-s">
          <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground px-xxs">Rounds</p>
          {sent.map((round) => (
            <RoundCard key={round.id} round={round} busy={acting} />
          ))}
        </div>
      )}

      {/* Agent notes */}
      <div className="rounded-m bg-card p-m flex flex-col gap-s">
        <button
          type="button"
          className="flex items-center justify-between text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring rounded-xs"
          onClick={() => setShowMemory((v) => !v)}
          aria-expanded={showMemory}
        >
          <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">The agent's notes</span>
          <span className="text-xs text-muted-foreground">{showMemory ? "Hide" : "Show"}</span>
        </button>
        <AnimatePresence initial={false}>
          {showMemory && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transitionSmall} className="overflow-hidden">
              {snap.memory ? <Markdown source={snap.memory} /> : <p className="text-s text-muted-foreground">No notes yet.</p>}
              <p className="text-xxs text-muted-foreground mt-s">
                {snap.files.length} files · {snap.state.provider ? `${snap.state.provider} · ${snap.state.model}` : "no model run yet"}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {snap.state.lastError && (
        <p className="text-xs text-error px-xxs">
          <Check size={12} className="inline mr-xxs" aria-hidden />
          Last run: {snap.state.lastError}
        </p>
      )}
    </div>
  );
}

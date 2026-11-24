import { useEffect, useState, type FormEvent } from "react";
import { Bot, Copy, CornerDownRight, LoaderCircle, Megaphone, RefreshCw, Send, Sparkles } from "lucide-react";
import { approveRound, rejectRound } from "@/api/client";
import {
  apiErrorMessage,
  fetchAgentAccess,
  formatMoney,
  planTestimonials,
  replanBrief,
  steerBrief,
  type BriefBoard as Board,
  type BriefEvent,
  type BriefRoundAsk,
} from "@/api/study";
import { trackEvent } from "@/lib/posthog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { MoneyInput } from "@/components/creator/MoneyInput";
import { centsToDollars, dollarsToCents } from "@/components/creator/studyUi";
import { describeDeadline } from "@/lib/deadline";
import { labelClass, TestimonialTag } from "@/components/study/BriefBoard";

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function people(n: number) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function Asks({ asks }: { asks: BriefRoundAsk[] }) {
  return (
    <ul className="flex flex-col gap-xs">
      {asks.map((ask) => (
        <li key={ask.id} className="rounded-s bg-muted px-s py-xs">
          <p className="text-s text-foreground">{ask.text}</p>
          <p className="mt-xxs text-xs text-muted-foreground">
            {ask.targets.length === 0 ? "For everyone" : ask.targets.length <= 3 ? `For ${ask.targets.join(", ")}` : `For ${people(ask.targets.length)}`}
            {ask.hint ? ` · ${ask.hint}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Serves({ board, ids }: { board: Board; ids: string[] }) {
  const texts = ids.map((id) => board.items.find((i) => i.id === id)?.text).filter((t): t is string => !!t);
  if (texts.length === 0) return null;
  return (
    <div className="flex flex-col gap-xxs">
      <p className="text-xs text-muted-foreground">Digs into</p>
      <ul className="flex flex-col gap-xxs">
        {texts.map((t) => (
          <li key={t} className="flex items-start gap-xs text-xs text-neutral-8">
            <CornerDownRight size={14} className="mt-xxs shrink-0 text-color-1" aria-hidden />
            <span className="min-w-0">{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What goes out next. The agent plans it from the open questions and the
 * steers; the research team prices it and sends it; the client watches the
 * plan change as they steer.
 */
function NextRound({ board, apiKey, onBoard, reload }: { board: Board; apiKey: string; onBoard: (b: Board) => void; reload: () => Promise<void> }) {
  const round = board.nextRound;
  const canManage = board.you.canManage;
  const currency = board.rewards.currency;
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState<"send" | "plan" | "reject" | null>(null);

  // A new plan arrives with its own price; an edit in progress on the same plan is kept.
  useEffect(() => {
    setPrice(round && round.cost.rewardCents > 0 ? String(round.cost.rewardCents / 100) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  const plan = async () => {
    setBusy("plan");
    try {
      onBoard(await replanBrief(apiKey, board.survey.id));
    } catch (err) {
      toast.error(apiErrorMessage(err, "The agent couldn't plan a round."));
    } finally {
      setBusy(null);
    }
  };

  if (!round) {
    return (
      <section className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="next-round" data-state={board.planning ? "planning" : "none"}>
        <h2 className={labelClass}>Next round</h2>
        {board.planning ? (
          <p className="flex items-center gap-xs text-s text-neutral-8">
            <LoaderCircle size={16} className="animate-spin text-color-1" aria-hidden />
            The agent is planning the next round from your steer.
          </p>
        ) : (
          <p className="text-s text-muted-foreground">
            {canManage
              ? "Nothing planned yet. The agent plans a round when the brief changes or someone steers, or you can ask for one now."
              : "Nothing planned yet. Add a question or steer one, and the agent plans the next round around it."}
          </p>
        )}
        {canManage && (
          <Button type="button" variant="secondary" onClick={plan} disabled={busy !== null} data-testid="plan-round">
            {busy === "plan" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            Plan the next round
          </Button>
        )}
      </section>
    );
  }

  // A testimonial round asks named people for a line meant for public use; its price is a bonus for recording one.
  const testimonial = round.purpose === "testimonial";
  const cents = price.trim() === "" ? 0 : Math.max(0, Math.round(parseFloat(price) * 100) || 0);
  const maxCents = cents * round.cost.reach;
  const remaining = round.cost.remainingCents;
  const fits = cents === 0 || remaining === null || maxCents <= remaining;
  const costLine =
    cents === 0
      ? "Unpaid round"
      : round.cost.reach === 0
      ? "Nobody in this round is a paid participant yet"
      : `Up to ${people(round.cost.reach)} × ${formatMoney(cents, currency)} = ${formatMoney(maxCents, currency)}${
          remaining === null ? " · no budget set" : ` · ${formatMoney(Math.max(0, remaining), currency)} of ${formatMoney(round.cost.budgetCents ?? 0, currency)} left`
        }`;

  const send = async () => {
    setBusy("send");
    try {
      const r = await approveRound(apiKey, board.survey.id, round.id, cents > 0 ? cents : null);
      toast.success(r.notified > 0 ? `Round ${round.number} sent to ${people(r.notified)}.` : `Round ${round.number} is open.`);
      await reload();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't send the round."));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    try {
      await rejectRound(apiKey, board.survey.id, round.id);
      await reload();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't dismiss the round."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-m bg-card shadow-edge-accent p-m flex flex-col gap-s" data-testid="next-round" data-state={board.planning ? "planning" : "planned"}>
      <div className="flex items-center justify-between gap-s">
        <h2 className={labelClass}>Next round</h2>
        <p className="text-xs text-muted-foreground">Planned {ago(round.createdAt)}</p>
      </div>
      <p className="text-s font-medium text-foreground">
        Round {round.number}
        {testimonial && (
          <>
            {" "}
            <TestimonialTag label="Testimonials" />
          </>
        )}
        <span className="font-regular text-muted-foreground"> · {round.kind === "probe" ? "follow-ups for the people named" : "the same ask for everyone"}</span>
      </p>

      {board.planning && (
        <p className="flex items-center gap-xs rounded-s bg-color-1-transparent px-s py-xs text-xs text-color-1">
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          The agent is re-planning this round from the latest steer.
        </p>
      )}

      {round.rationale && <p className="text-s text-neutral-8">{round.rationale}</p>}
      <Asks asks={round.asks} />
      <Serves board={board} ids={round.serves} />
      {testimonial && board.survey.testimonialNotice && (
        <p className="text-xs text-muted-foreground" data-testid="testimonial-notice">
          Each person is told: “{board.survey.testimonialNotice}” Recording it is their consent.
        </p>
      )}

      {canManage ? (
        <>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="round-price" className="text-xs text-muted-foreground">
              {testimonial ? "Bonus per testimonial" : "Reward per answer"} ({currency})
            </Label>
            <Input
              id="round-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0"
              className="font-data tabular-nums"
              data-testid="round-price"
            />
            <p className={`text-xs ${fits ? "text-muted-foreground" : "text-error"}`} data-testid="round-cost">
              {costLine}
              {!fits ? `. Lower the ${testimonial ? "bonus" : "reward"} or raise the budget.` : ""}
            </p>
          </div>
          <div className="flex gap-xs">
            <Button type="button" variant="secondary" className="flex-1" onClick={reject} disabled={busy !== null}>
              Not now
            </Button>
            <Button type="button" className="flex-1" onClick={send} disabled={busy !== null || !fits || board.planning} data-testid="round-send">
              {busy === "send" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              Send round
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={plan} disabled={busy !== null}>
            {busy === "plan" ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            Plan it again
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="round-cost">
            {round.cost.rewardCents > 0
              ? `Up to ${people(round.cost.reach)} × ${formatMoney(round.cost.rewardCents, currency)} = ${formatMoney(round.cost.maxCents, currency)}`
              : "Unpaid round"}
          </p>
          <p className="text-xs text-muted-foreground">The research team sends rounds. Steer a question to change this plan.</p>
        </>
      )}
    </section>
  );
}

function LiveRound({ board }: { board: Board }) {
  const round = board.liveRound;
  if (!round) return null;
  const deadline = describeDeadline(round.closesAt);
  const testimonial = round.purpose === "testimonial";
  return (
    <section className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="live-round">
      <div className="flex items-center justify-between gap-s">
        <h2 className={labelClass}>Out now</h2>
        <p className="text-xs text-muted-foreground">Sent {ago(round.sentAt)}</p>
      </div>
      <p className="text-s font-medium text-foreground">
        Round {round.number}
        {testimonial && (
          <>
            {" "}
            <TestimonialTag label="Testimonials" />
          </>
        )}
        <span className="font-regular text-muted-foreground">
          {" "}
          · {people(round.answered)} answered
          {round.rewardCents > 0 ? ` · ${formatMoney(round.rewardCents, board.rewards.currency)} per ${testimonial ? "testimonial" : "answer"}` : ""}
          {deadline ? ` · ${deadline.charAt(0).toLowerCase()}${deadline.slice(1)}` : ""}
        </span>
      </p>
      <Asks asks={round.asks} />
      <Serves board={board} ids={round.serves} />
    </section>
  );
}

/** A steer on the study as a whole, not on one question. */
function StudySteer({ board, apiKey, onBoard }: { board: Board; apiKey: string; onBoard: (b: Board) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const general = board.steers.filter((s) => !s.itemId);
  const send = async () => {
    setBusy(true);
    try {
      onBoard(await steerBrief(apiKey, board.survey.id, note.trim()));
      setNote("");
      toast.success("Sent. The agent is working it into the next round.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't send that to the agent."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-m bg-card p-m flex flex-col gap-s">
      <h2 className={labelClass}>Steer the study</h2>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={600}
        placeholder="Something to do next that isn't about one question: who to ask, a hunch to test."
        aria-label="Steer the study"
        data-testid="study-steer-input"
      />
      <Button type="button" size="sm" className="self-start" disabled={busy || note.trim().length < 4} onClick={send} data-testid="study-steer-send">
        {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        Send to the agent
      </Button>
      {general.length > 0 && (
        <ul className="flex flex-col gap-xs">
          {general.map((s) => (
            <li key={s.id} className="flex items-start gap-xs text-xs text-muted-foreground">
              <CornerDownRight size={14} className="mt-xxs shrink-0 text-color-1" aria-hidden />
              <p className="min-w-0">
                <span className="text-neutral-8">{s.by}</span>
                {s.role === "client" ? " (client)" : ""}: <span className="text-foreground">{s.body}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Research team: have the agent plan a testimonial round. It picks the people
 * who were positive and asks each for a line meant for public use. The plan
 * lands under "Next round" like any other, to be priced and sent from there.
 */
function TestimonialPlan({ board, apiKey, reload }: { board: Board; apiKey: string; reload: () => Promise<void> }) {
  const [who, setWho] = useState("");
  // null = untouched: the field shows the study's default reward.
  const [bonusDraft, setBonusDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Nobody has spoken yet, so there is nobody to ask.
  if (!board.you.canManage || !(board.voices > 0)) return null;

  const bonus = bonusDraft ?? centsToDollars(board.rewards.defaultCents || null);

  const plan = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const hint = who.trim();
    // An empty field is no bonus. It goes out as 0: left out, the server prices the round at the study's default.
    const bonusCents = dollarsToCents(bonus) ?? 0;
    setBusy(true);
    trackEvent("testimonial_plan_requested", { surveyId: board.survey.id, hasWho: hint.length > 0, bonusCents });
    try {
      await planTestimonials(apiKey, board.survey.id, { who: hint || undefined, bonusCents });
      await reload();
      setWho("");
      toast.success("Testimonial round planned. Check it under Next round.");
    } catch (err) {
      // "Nobody has been positive yet" comes back as a 409 with the sentence to show.
      toast.error(apiErrorMessage(err, "The agent couldn't plan a testimonial round."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="testimonial-plan">
      <h2 className={labelClass}>Ask for testimonials</h2>
      <p className="text-s text-neutral-8">
        The agent picks the people who were positive and asks each for a line you can use in public. They are told so on the ask, and it pays a bonus.
      </p>
      <form className="flex flex-col gap-s" onSubmit={plan}>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="testimonial-who" className="text-xs text-muted-foreground">
            Who
          </Label>
          <Input
            id="testimonial-who"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            maxLength={300}
            placeholder="People who were happy with onboarding"
            disabled={busy}
            data-testid="testimonial-who"
          />
        </div>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="testimonial-bonus" className="text-xs text-muted-foreground">
            Bonus per testimonial
          </Label>
          <MoneyInput
            id="testimonial-bonus"
            currency={board.rewards.currency}
            value={bonus}
            onValueChange={setBonusDraft}
            // Cents are fine: the field's default step of 1 would refuse "12.50" on submit.
            step="any"
            placeholder="0"
            disabled={busy}
            data-testid="testimonial-bonus"
          />
        </div>
        {/* The busy sentence is long for a pill: let it wrap on a 320px phone instead of overflowing the card. */}
        <Button type="submit" size="sm" className="self-start max-w-full whitespace-normal text-left" disabled={busy} data-testid="testimonial-submit">
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Megaphone aria-hidden />}
          {busy ? "The agent is choosing who to ask…" : "Plan a testimonial round"}
        </Button>
      </form>
    </section>
  );
}

function sentence(e: BriefEvent): string {
  const q = e.itemText ? `“${e.itemText}”` : "a question";
  // A change made through the MCP server reads as the person's agent, not the person.
  const by = e.viaAgent ? `${e.by}'s agent` : e.by;
  switch (e.type) {
    case "goal_edited":
      return `${by} rewrote what the study is for`;
    case "item_added":
      return `${by} added ${q}`;
    case "item_edited":
      return `${by} reworded a question to ${q}`;
    case "item_dropped":
      return `${by} dropped ${q}`;
    case "item_reopened":
      return `${by} reopened ${q}`;
    case "item_answered":
      return `${by} marked ${q} answered`;
    case "suggestion_made":
      return `The agent suggested adding “${e.body ?? ""}”`;
    case "suggestion_accepted":
      return `${by} added the agent's suggestion ${q}`;
    case "suggestion_dismissed":
      return `${by} passed on the agent's suggestion ${q}`;
    case "status_changed": {
      const [from, to] = (e.body ?? "").split(" → ");
      return `The agent moved ${q} from ${from} to ${to}`;
    }
    case "steer":
      return `${by} steered${e.itemText ? ` on ${q}` : ""}: ${e.body ?? ""}${e.roundNumber ? ` (taken up in round ${e.roundNumber})` : ""}`;
    case "round_proposed":
      return `The agent planned round ${e.roundNumber ?? ""}${e.body ? `: ${e.body}` : ""}`;
    case "round_sent":
      return `${by} sent round ${e.roundNumber ?? ""}`;
    default:
      return e.body ?? "";
  }
}

/** How the brief got to where it is: every change, by whom, newest first. */
function Timeline({ events }: { events: BriefEvent[] }) {
  const [all, setAll] = useState(false);
  if (events.length === 0) return null;
  const shown = all ? events : events.slice(0, 6);
  return (
    <section className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="brief-timeline">
      <h2 className={labelClass}>How the brief got here</h2>
      <ol className="flex flex-col gap-s">
        {shown.map((e) => (
          <li key={e.id} className="flex items-start gap-xs" data-role={e.role}>
            <span
              className={`mt-xxs flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xxs font-medium ${
                e.role === "agent" ? "bg-color-1-transparent text-color-1" : e.role === "client" ? "bg-badge text-badge-foreground" : "bg-muted text-neutral-8"
              }`}
              aria-hidden
            >
              {e.role === "agent" || e.viaAgent ? <Bot size={12} /> : e.by.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-neutral-8">{sentence(e)}</p>
              <p className="font-data text-xxs tabular-nums text-muted-foreground">
                {ago(e.at)}
                {e.role === "client" ? " · client" : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {events.length > 6 && (
        <button type="button" className="self-start text-xs text-muted-foreground" onClick={() => setAll((v) => !v)}>
          {all ? "Show less" : `Show all ${events.length}`}
        </button>
      )}
    </section>
  );
}

function Budget({ board }: { board: Board }) {
  const r = board.rewards;
  if (r.budgetCents === null && r.committedCents === 0) return null;
  return (
    <section className="rounded-m bg-card p-m flex items-center justify-between gap-s" data-testid="study-budget">
      <h2 className={labelClass}>Rewards</h2>
      <p className="font-data text-xs tabular-nums text-neutral-8">
        {formatMoney(r.committedCents, r.currency)} promised
        {r.budgetCents !== null ? ` of ${formatMoney(r.budgetCents, r.currency)}` : ""}
      </p>
    </section>
  );
}

/**
 * Bring your own AI agent. It connects to Parlo's MCP server, takes the same
 * kind of seat you hold with the invite link, and can then read the study,
 * work on the brief and steer (and, for the research team, plan and send
 * rounds). What it changes is logged as "<your name>'s agent".
 */
function AgentAccess({ board, apiKey }: { board: Board; apiKey: string }) {
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    setBusy(true);
    try {
      const access = await fetchAgentAccess(apiKey, board.survey.id);
      const me = board.team.find((t) => t.userId === board.you.userId)?.name;
      await navigator.clipboard.writeText(
        [
          `Work with me on a research study in Parlo.`,
          `1. Connect to the MCP server at ${access.mcpUrl} (choose "create new account" if it asks you to sign in).`,
          `2. Call join_study with this invite link${me && me !== "Researcher" && me !== "Client" ? ` and the name "${me}"` : ""}: ${access.inviteLink}`,
          `3. Call get_study with study_id ${access.studyId} and read it before changing anything.`,
          `You will hold a ${access.seat} seat, the same as mine. Keep the invite link private.`,
        ].join("\n")
      );
      trackEvent("agent_access_copied", { surveyId: board.survey.id, role: board.you.role });
      toast.success("Copied. Paste it to your agent.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't copy that."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="agent-access">
      <h2 className={labelClass}>Work on it with your AI agent</h2>
      <p className="text-s text-neutral-8">
        Your agent can read this study, add questions and steer{board.you.canManage ? ", and plan and send rounds" : ""}, with the same seat you hold. What it changes shows here as your agent's.
      </p>
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={copy} disabled={busy} data-testid="agent-access-copy">
        {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Copy aria-hidden />}
        Copy instructions for your agent
      </Button>
    </section>
  );
}

/** Everything beside the brief: what is out, what goes out next, steering, the budget, the log. */
export default function PlanPanel({ board, apiKey, onBoard, reload }: { board: Board; apiKey: string; onBoard: (b: Board) => void; reload: () => Promise<void> }) {
  return (
    <div className="flex flex-col gap-m">
      <NextRound board={board} apiKey={apiKey} onBoard={onBoard} reload={reload} />
      <LiveRound board={board} />
      <StudySteer board={board} apiKey={apiKey} onBoard={onBoard} />
      <TestimonialPlan board={board} apiKey={apiKey} reload={reload} />
      <Budget board={board} />
      <AgentAccess board={board} apiKey={apiKey} />
      <Timeline events={board.timeline} />
    </div>
  );
}

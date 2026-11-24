import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, ChevronDown, CornerDownRight, LoaderCircle, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Sparkles, X } from "lucide-react";
import {
  addBriefItem,
  answerSuggestion,
  apiErrorMessage,
  editGoal,
  steerBrief,
  updateBriefItem,
  type BriefBoard as Board,
  type BriefItem,
  type BriefSteer,
} from "@/api/study";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import VoiceNotePill from "@/components/VoiceNotePill";
import { transitionSmall } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";

/** Uppercase section label, the theme's role for it. */
export const labelClass = "font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground";

interface Mutations {
  apiKey: string;
  surveyId: string;
  /** Every mutation answers with the whole board; hand it up. */
  onBoard: (board: Board) => void;
}

const STATUS: Record<"open" | "emerging" | "answered", { label: string; tone: string; dot: string; help: string }> = {
  open: { label: "Open", tone: "bg-muted text-neutral-8", dot: "shadow-edge bg-transparent", help: "Nothing solid yet" },
  emerging: { label: "Emerging", tone: "bg-warning-transparent text-warning", dot: "bg-warning", help: "A pattern, thinly supported" },
  answered: { label: "Answered", tone: "bg-success-transparent text-success", dot: "bg-success", help: "Several voices, a clear answer" },
};

function StatusPill({ status }: { status: "open" | "emerging" | "answered" }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-xxs rounded-full px-xs py-xxs font-brand text-xxs font-medium tracking-xl uppercase ${s.tone}`} title={s.help}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

function originLine(item: BriefItem): string | null {
  if (item.origin === "client") return item.addedBy ? `Added by ${item.addedBy} · client` : "Added by the client";
  if (item.origin === "researcher") return item.addedBy ? `Added by ${item.addedBy}` : "Added by the research team";
  if (item.origin === "agent") return "Suggested by the agent";
  return "From the original brief";
}

/** What the participant allowed beyond the study. Nothing shows for "none": staying inside the study is the default. */
export function PublishChip({ consent }: { consent: "none" | "quote" | "voice" }) {
  if (consent === "none") return null;
  return (
    <span
      className="shrink-0 inline-flex items-center rounded-full bg-success-transparent px-xs py-xxs text-xxs font-medium text-success"
      title={consent === "voice" ? "They agreed their recorded voice can be used in public material" : "They agreed their words can be quoted in public material, without their name"}
      data-testid="publish-chip"
    >
      {consent === "voice" ? "Voice can be used" : "Can be quoted"}
    </span>
  );
}

function Quote({ quote, answer }: BriefItem["evidence"][number]) {
  return (
    <li className="rounded-s bg-muted p-s flex flex-col gap-xs">
      <p className="text-s text-foreground">“{quote}”</p>
      <div className="flex items-center justify-between gap-s">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {answer.who} · {answer.roundNumber === 0 ? "interview" : `round ${answer.roundNumber}`}
        </p>
        <PublishChip consent={answer.publishConsent} />
      </div>
      {answer.audioUrl && <VoiceNotePill url={answer.audioUrl} durationMs={answer.durationMs} className="bg-background" />}
    </li>
  );
}

function SteerRow({ steer, state }: { steer: BriefSteer; state: string }) {
  return (
    <li className="flex items-start gap-xs text-xs text-muted-foreground" data-testid="steer-row">
      <CornerDownRight size={14} className="mt-xxs shrink-0 text-color-1" aria-hidden />
      <p className="min-w-0">
        <span className="text-neutral-8">{steer.by}</span>
        {steer.role === "client" ? " (client)" : ""}: <span className="text-foreground">{steer.body}</span>
        <span className="block">{state}</span>
      </p>
    </li>
  );
}

/**
 * One question the study must answer: where it stands, what the answers say,
 * the voices behind that, and the place where either side says "dig into this".
 */
function ItemCard({
  item,
  board,
  mutate,
}: {
  item: BriefItem;
  board: Board;
  mutate: Mutations;
}) {
  const [steering, setSteering] = useState(false);
  const [note, setNote] = useState("");
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [allQuotes, setAllQuotes] = useState(false);
  const [busy, setBusy] = useState(false);

  const status = item.status as "open" | "emerging" | "answered";
  const steers = board.steers.filter((s) => s.itemId === item.id);
  const inPlan = board.nextRound?.serves.includes(item.id) ?? false;
  const askedNow = board.liveRound?.serves.includes(item.id) ?? false;
  const quotes = allQuotes ? item.evidence : item.evidence.slice(0, 1);

  const run = async (fn: () => Promise<Board>, fallback: string, after?: () => void) => {
    setBusy(true);
    try {
      mutate.onBoard(await fn());
      after?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const sendSteer = () =>
    run(
      () => steerBrief(mutate.apiKey, mutate.surveyId, note.trim(), item.id),
      "Couldn't send that to the agent.",
      () => {
        setNote("");
        setSteering(false);
        toast.success("Sent. The agent is working it into the next round.");
      }
    );

  const steerState = board.planning
    ? "The agent is working this into the next round"
    : inPlan
    ? `In the plan for round ${board.nextRound?.number}`
    : "Waiting for the next plan";

  return (
    <motion.li layout="position" transition={transitionSmall} className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="brief-item" data-status={item.status}>
      <div className="flex items-center gap-xs">
        <StatusPill status={status} />
        <span className="font-data text-xs tabular-nums text-muted-foreground">
          {item.voices} {item.voices === 1 ? "voice" : "voices"}
        </span>
        {(askedNow || inPlan) && (
          <span className="inline-flex items-center rounded-full bg-color-1-transparent px-xs py-xxs text-xxs font-medium text-color-1">
            {askedNow ? `Being asked now · round ${board.liveRound?.number}` : `Round ${board.nextRound?.number} digs into this`}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto -mr-xs -my-xs shrink-0"
          aria-label="More for this question"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-xs">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={280} aria-label="The question" />
          <div className="flex gap-xs">
            <Button
              type="button"
              size="sm"
              disabled={busy || text.trim().length < 8}
              onClick={() => run(() => updateBriefItem(mutate.apiKey, mutate.surveyId, item.id, { text: text.trim() }), "Couldn't save that.", () => setEditing(false))}
            >
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setText(item.text); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <h3 className="font-editorial text-m font-medium text-foreground">{item.text}</h3>
      )}

      {item.finding ? (
        <p className="text-s text-neutral-8">{item.finding}</p>
      ) : (
        <p className="text-s text-muted-foreground">No answer to this yet.</p>
      )}

      {item.evidence.length > 0 && (
        <div className="flex flex-col gap-xs">
          <ul className="flex flex-col gap-xs">
            {quotes.map((e, i) => (
              <Quote key={`${e.answer.id}-${i}`} {...e} />
            ))}
          </ul>
          {item.evidence.length > 1 && (
            <button type="button" className="self-start inline-flex items-center gap-xxs text-xs text-muted-foreground" onClick={() => setAllQuotes((v) => !v)}>
              <ChevronDown size={14} className={allQuotes ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
              {allQuotes ? "Fewer voices" : `${item.evidence.length - 1} more ${item.evidence.length === 2 ? "voice" : "voices"}`}
            </button>
          )}
        </div>
      )}

      {steers.length > 0 && (
        <ul className="flex flex-col gap-xs">
          {steers.map((s) => (
            <SteerRow key={s.id} steer={s} state={steerState} />
          ))}
        </ul>
      )}

      <AnimatePresence initial={false}>
        {steering && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transitionSmall} className="overflow-hidden">
            <div className="flex flex-col gap-xs">
              <Textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={600}
                placeholder="What should the agent dig into here? Who should it ask?"
                aria-label="Steer the agent on this question"
                data-testid="steer-input"
              />
              <div className="flex gap-xs">
                <Button type="button" size="sm" disabled={busy || note.trim().length < 4} onClick={sendSteer} data-testid="steer-send">
                  {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                  Send to the agent
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSteering(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between gap-s">
        {!steering ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setSteering(true)} data-testid="steer-open">
            <Sparkles aria-hidden />
            Dig into this
          </Button>
        ) : (
          <span />
        )}
        <p className="min-w-0 truncate text-xs text-muted-foreground">{originLine(item)}</p>
      </div>

      <AnimatePresence initial={false}>
        {menu && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transitionSmall} className="overflow-hidden">
            <div className="flex flex-wrap gap-xs">
              {status === "answered" ? (
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run(() => updateBriefItem(mutate.apiKey, mutate.surveyId, item.id, { status: "open" }), "Couldn't reopen it.", () => setMenu(false))}>
                  <RotateCcw aria-hidden />
                  Reopen
                </Button>
              ) : (
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run(() => updateBriefItem(mutate.apiKey, mutate.surveyId, item.id, { status: "answered" }), "Couldn't mark it answered.", () => setMenu(false))}>
                  <Check aria-hidden />
                  We have our answer
                </Button>
              )}
              <Button type="button" size="sm" variant="secondary" onClick={() => { setEditing(true); setMenu(false); }}>
                <Pencil aria-hidden />
                Reword
              </Button>
              <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => run(() => updateBriefItem(mutate.apiKey, mutate.surveyId, item.id, { status: "dropped" }), "Couldn't drop it.", () => setMenu(false))}>
                <X aria-hidden />
                Drop from the brief
              </Button>
            </div>
            {item.setByHand && <p className="mt-xs text-xs text-muted-foreground">Someone on the team set this status, so the agent leaves it alone.</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function GoalCard({ board, mutate }: { board: Board; mutate: Mutations }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState(board.goal);
  const [busy, setBusy] = useState(false);
  const long = board.goal.length > 260;

  const save = async () => {
    setBusy(true);
    try {
      mutate.onBoard(await editGoal(mutate.apiKey, mutate.surveyId, goal.trim()));
      setEditing(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't save that."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="brief-goal">
      <div className="flex items-center justify-between gap-s">
        <h2 className={labelClass}>What this study is for</h2>
        {!editing && (
          <Button type="button" size="sm" variant="ghost" className="-my-xs -mr-xs" onClick={() => { setGoal(board.goal); setEditing(true); }}>
            <Pencil aria-hidden />
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <>
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={6} maxLength={6000} aria-label="What this study is for" />
          <div className="flex gap-xs">
            <Button type="button" size="sm" disabled={busy || goal.trim().length < 10} onClick={save}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden />}
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : board.goal ? (
        <>
          <p className={`text-s text-neutral-8 whitespace-pre-line ${long && !open ? "line-clamp-4" : ""}`}>{board.goal}</p>
          {long && (
            <button type="button" className="self-start text-xs text-muted-foreground" onClick={() => setOpen((v) => !v)}>
              {open ? "Show less" : "Show all"}
            </button>
          )}
        </>
      ) : (
        <p className="text-s text-muted-foreground">Nobody has written down what this study is for yet.</p>
      )}
    </section>
  );
}

function Suggestion({ item, mutate }: { item: BriefItem; mutate: Mutations }) {
  const [busy, setBusy] = useState(false);
  const answer = async (verdict: "accept" | "dismiss") => {
    setBusy(true);
    try {
      mutate.onBoard(await answerSuggestion(mutate.apiKey, mutate.surveyId, item.id, verdict));
      if (verdict === "accept") toast.success("Added to the brief.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't do that."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-m bg-card shadow-edge-accent p-m flex flex-col gap-s" data-testid="brief-suggestion">
      <div className="flex items-center gap-xs text-xs text-color-1">
        <Bot size={14} aria-hidden />
        <span>
          {item.voices} {item.voices === 1 ? "person" : "people"} raised this without being asked
        </span>
      </div>
      <h3 className="font-editorial text-m font-medium text-foreground">{item.text}</h3>
      {item.why && <p className="text-s text-neutral-8">{item.why}</p>}
      <div className="flex gap-xs">
        <Button type="button" size="sm" disabled={busy} onClick={() => answer("accept")} data-testid="suggestion-accept">
          <Plus aria-hidden />
          Add to the brief
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => answer("dismiss")}>
          Not now
        </Button>
      </div>
    </li>
  );
}

function AddQuestion({ mutate }: { mutate: Mutations }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const value = text.trim();
    if (value.length < 8) return;
    setBusy(true);
    try {
      mutate.onBoard(await addBriefItem(mutate.apiKey, mutate.surveyId, value));
      setText("");
      trackEvent("brief_question_added");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't add that."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex items-center gap-xs"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={280}
        placeholder="Add a question the study should answer"
        aria-label="Add a question the study should answer"
        data-testid="brief-add-input"
      />
      <Button type="submit" size="icon" className="shrink-0" disabled={busy || text.trim().length < 8} aria-label="Add the question" data-testid="brief-add">
        {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
      </Button>
    </form>
  );
}

/** The brief itself: what the study is for, and the questions it has to answer. */
export default function BriefBoard({ board, apiKey, onBoard }: { board: Board; apiKey: string; onBoard: (board: Board) => void }) {
  const mutate: Mutations = { apiKey, surveyId: board.survey.id, onBoard };
  const [showDropped, setShowDropped] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const bringBack = async (item: BriefItem) => {
    setBusyId(item.id);
    try {
      onBoard(await updateBriefItem(apiKey, board.survey.id, item.id, { status: "open" }));
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't bring it back."));
    } finally {
      setBusyId(null);
    }
  };

  const answered = board.items.filter((i) => i.status === "answered").length;

  return (
    <div className="flex flex-col gap-m" data-testid="brief-board">
      <GoalCard board={board} mutate={mutate} />

      <section className="flex flex-col gap-s">
        <div className="flex items-baseline justify-between gap-s px-xxs">
          <h2 className={labelClass}>What we need to find out</h2>
          {board.items.length > 0 && (
            <p className="font-data text-xs tabular-nums text-muted-foreground">
              {answered} of {board.items.length} answered
            </p>
          )}
        </div>

        {board.items.length === 0 ? (
          <div className="rounded-m bg-card p-m">
            <p className="text-s text-neutral-8">No questions on the brief yet.</p>
            <p className="text-s text-muted-foreground">Add the first thing this study has to answer. Both sides can add, reword and drop questions as the answers come in.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-xs">
            {board.items.map((item) => (
              <ItemCard key={item.id} item={item} board={board} mutate={mutate} />
            ))}
          </ul>
        )}

        <AddQuestion mutate={mutate} />
      </section>

      {board.suggestions.length > 0 && (
        <section className="flex flex-col gap-s">
          <h2 className={`${labelClass} px-xxs`}>The agent keeps hearing this</h2>
          <ul className="flex flex-col gap-xs">
            {board.suggestions.map((item) => (
              <Suggestion key={item.id} item={item} mutate={mutate} />
            ))}
          </ul>
        </section>
      )}

      {board.dropped.length > 0 && (
        <section className="flex flex-col gap-xs">
          <button type="button" className="self-start inline-flex items-center gap-xxs px-xxs text-xs text-muted-foreground" aria-expanded={showDropped} onClick={() => setShowDropped((v) => !v)}>
            <ChevronDown size={14} className={showDropped ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
            Dropped from the brief ({board.dropped.length})
          </button>
          {showDropped && (
            <ul className="flex flex-col gap-xs">
              {board.dropped.map((item) => (
                <li key={item.id} className="rounded-m bg-card p-m flex items-center justify-between gap-s">
                  <p className="min-w-0 text-s text-muted-foreground">{item.text}</p>
                  <Button type="button" size="sm" variant="secondary" className="shrink-0" disabled={busyId === item.id} onClick={() => bringBack(item)}>
                    Bring back
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

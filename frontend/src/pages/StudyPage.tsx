import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, LayoutDashboard, LoaderCircle } from "lucide-react";
import { fetchBrief, type BriefBoard as Board } from "@/api/study";
import AnswersList from "@/components/study/AnswersList";
import BriefBoard, { labelClass } from "@/components/study/BriefBoard";
import PlanPanel from "@/components/study/PlanPanel";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/lib/markdown";
import { trackEvent } from "@/lib/posthog";
import { getDeviceAuth } from "@/lib/sessionStore";
import { initialsFor } from "@/lib/parloRow";

type Tab = "brief" | "answers" | "report";
const POLL_MS = 6000;

const chip = "rounded-full px-m py-xs font-ui text-xs font-medium tracking-l transition-colors";
const chipTone = (active: boolean) => (active ? "bg-primary text-primary-foreground" : "bg-muted text-neutral-8");

function Team({ board }: { board: Board }) {
  const names = board.team.slice(0, 5);
  return (
    <ul className="flex -space-x-1" aria-label="The team on this study">
      {names.map((t) => (
        <li
          key={t.userId}
          title={`${t.name} · ${t.role === "client" ? "client" : "research team"}`}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xxs font-medium shadow-[0_0_0_2px_var(--neutral-1)] ${
            t.role === "client" ? "bg-badge text-badge-foreground" : "bg-muted text-neutral-8"
          }`}
        >
          {initialsFor(t.name)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The first steps of a new study, for the research team: the people to hear
 * from, then the client. Gone once both are done. The client is invited
 * before answers are collected because it only ever hears answers given
 * after the consent screen named it.
 */
function GettingStarted({ board, onGo }: { board: Board; onGo: () => void }) {
  if (!board.you.canManage || !board.survey.dashboardCode) return null;
  const hasPeople = board.participants > 0;
  const hasClient = board.team.some((t) => t.role === "client");
  if (hasPeople && hasClient) return null;
  const steps = [
    {
      done: hasClient,
      title: hasClient ? "The client is in" : "Invite the client",
      body: hasClient ? null : "Do this first. The client only hears answers given after participants are told who commissioned the study.",
      action: "Invite the client",
    },
    {
      done: hasPeople,
      title: hasPeople ? `${board.participants} ${board.participants === 1 ? "person is" : "people are"} in the study` : "Bring in the people to hear from",
      body: hasPeople ? null : "Each gets a personal link. Paste an earlier interview with them and the agent reads it as their first answer.",
      action: "Add participants",
    },
  ];
  return (
    <section className="rounded-m bg-card shadow-edge-accent p-m flex flex-col gap-s" data-testid="study-getting-started">
      <h2 className={labelClass}>Get this study going</h2>
      <ol className="flex flex-col gap-s">
        {steps.map((s) => (
          <li key={s.action} className="flex items-start gap-s">
            <span
              className={`mt-xxs flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${s.done ? "bg-success-transparent text-success" : "shadow-edge"}`}
              aria-hidden
            >
              {s.done && <Check size={12} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-s font-medium ${s.done ? "text-muted-foreground" : "text-foreground"}`}>{s.title}</p>
              {s.body && <p className="text-xs text-muted-foreground">{s.body}</p>}
            </div>
            {!s.done && (
              <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={onGo}>
                {s.action}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * `/study/:surveyId`: where the research team and the client work on a study
 * together. The brief (what it has to answer, and how far the answers go),
 * the round that goes out next, the raw answers, and the agent's report.
 */
export default function StudyPage() {
  const { surveyId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "answers" ? "answers" : params.get("tab") === "report" ? "report" : "brief";

  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    getDeviceAuth()
      .then((auth) => setApiKey(auth?.apiKey ?? null))
      .catch(() => setApiKey(null));
  }, []);

  const load = useCallback(async () => {
    if (!apiKey) return;
    try {
      const b = await fetchBrief(apiKey, surveyId);
      setBoard(b);
      setError(null);
      if (!opened.current) {
        opened.current = true;
        trackEvent("brief_opened", { surveyId, role: b.you.role });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // Keep showing what we have on a failed poll; only a first load can fail the page.
      setBoard((prev) => {
        if (!prev) setError(/API 40[134]/.test(message) ? "You don't have a seat on this study. Open your invite link to join it." : "Couldn't load this study.");
        return prev;
      });
    }
  }, [apiKey, surveyId]);

  useEffect(() => {
    if (!apiKey) return;
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [apiKey, load]);

  const setTab = (next: Tab) => {
    trackEvent("brief_tab", { surveyId, tab: next });
    setParams(next === "brief" ? {} : { tab: next }, { replace: true });
  };

  if (apiKey === null || error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-l">
        <div className="flex max-w-sm flex-col items-center gap-l text-center">
          <div className="flex flex-col gap-xs">
            <h1 className="font-brand text-l font-heavy text-foreground">{apiKey === null ? "Sign in to see this study" : "Can't open this study"}</h1>
            <p className="text-m text-muted-foreground">
              {apiKey === null ? "Open the invite link you were sent. It signs you in and takes you straight here." : error}
            </p>
          </div>
          <Button asChild>
            <a href="/">Go home</a>
          </Button>
        </div>
      </div>
    );
  }

  if (!board || !apiKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoaderCircle size={32} className="animate-spin text-color-1" aria-hidden />
      </div>
    );
  }

  const title = board.survey.title || "Untitled study";
  const facts = [
    board.survey.sponsor ? `For ${board.survey.sponsor}` : null,
    `${board.voices} ${board.voices === 1 ? "voice" : "voices"}`,
    `${board.answers} ${board.answers === 1 ? "answer" : "answers"}`,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-background" data-testid="study-page" data-role={board.you.role}>
      <div className="mx-auto flex w-full max-w-md flex-col px-m pb-xxl lg:max-w-6xl lg:px-l">
        <header className="flex flex-col gap-m pt-xl pb-m">
          <div className="flex items-center gap-s">
            <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/")} aria-label="Back to home" className="shrink-0 -ml-xs">
              <ChevronLeft className="!size-6" aria-hidden />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="font-brand text-l font-heavy text-foreground truncate">{title}</h1>
              <p className="text-xs text-muted-foreground truncate">{facts.join(" · ")}</p>
            </div>
            <Team board={board} />
            {board.survey.dashboardCode && (
              <Button type="button" variant="ghost" size="icon" className="shrink-0 -mr-xs" aria-label="Open the dashboard" onClick={() => navigate(`/d/${board.survey.dashboardCode}`)}>
                <LayoutDashboard aria-hidden />
              </Button>
            )}
          </div>
          <nav className="flex gap-xs" aria-label="Study sections">
            {(["brief", "answers", "report"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t} className={`${chip} ${chipTone(tab === t)}`} data-testid={`study-tab-${t}`}>
                {t === "brief" ? "Brief" : t === "answers" ? "Answers" : "Report"}
              </button>
            ))}
          </nav>
        </header>

        {tab === "brief" && (
          <div className="flex flex-col gap-m lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-l">
            <div className="flex flex-col gap-m">
              <GettingStarted board={board} onGo={() => navigate(`/d/${board.survey.dashboardCode}?tab=members`)} />
              <BriefBoard board={board} apiKey={apiKey} onBoard={setBoard} />
            </div>
            <aside className="lg:sticky lg:top-l">
              <PlanPanel board={board} apiKey={apiKey} onBoard={setBoard} reload={load} />
            </aside>
          </div>
        )}

        {tab === "answers" && (
          <div className="lg:max-w-2xl">
            <AnswersList apiKey={apiKey} surveyId={board.survey.id} isClient={board.you.role === "client"} sponsor={board.survey.sponsor} />
          </div>
        )}

        {tab === "report" && (
          <section className="rounded-m bg-card p-m flex flex-col gap-s lg:max-w-2xl" data-testid="study-report">
            <div className="flex items-center justify-between gap-s">
              <h2 className={labelClass}>The agent's report</h2>
              {board.report.updatedAt && (
                <p className="text-xs text-muted-foreground">Updated {new Date(board.report.updatedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              )}
            </div>
            {board.report.markdown ? (
              <Markdown source={board.report.markdown} />
            ) : (
              <p className="text-s text-muted-foreground">The agent writes the report a few minutes after the first answers come in, and rewrites it as more arrive.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

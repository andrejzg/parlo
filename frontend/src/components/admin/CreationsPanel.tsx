import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  fetchCreations,
  fetchCreationStats,
  fetchCreation,
  labelCreation,
  type CreationSummary,
  type CreationStats,
  type CreationDetail,
  type CreationLabel,
  type CreationEventRecord,
} from "@/api/client";
import { BRIEF_CHECKLIST, BRIEF_TICK_THRESHOLD } from "@/lib/briefChecklist";
import { captureException } from "@/lib/posthog";

/**
 * Admin → Creations: are Jev and Cerebras calibrated?
 *
 * Top: aggregate stats over the last N days (brief skip rate, Jev tick
 * timing, "Ask me more" rate, follow-ups Jev flagged, how much of the
 * generated questions survived the review screen, label counts).
 * Below: one row per creation; click for the full story with 👍/👎 labelling
 * per brief item, per follow-up and per question. Labels go to D1 and feed
 * the precision figures at the top.
 */

const JUDGE_THRESHOLD = 0.7;

function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}

function num(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  return x.toFixed(digits);
}

function secs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function fmtDate(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 px-4 py-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{label}</div>
      <div className="font-display text-2xl font-bold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}

function Verdict({
  current,
  onSet,
  size = "sm",
}: {
  current?: "good" | "bad";
  onSet: (v: "good" | "bad" | "clear") => void;
  size?: "sm" | "xs";
}) {
  const base = size === "xs" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm";
  const btn = (v: "good" | "bad", glyph: string, on: string) => (
    <button
      type="button"
      onClick={() => onSet(current === v ? "clear" : v)}
      title={v === "good" ? "Mark as right" : "Mark as wrong"}
      className={`${base} rounded-md border transition-colors ${
        current === v ? on : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
      }`}
    >
      {glyph}
    </button>
  );
  return (
    <span className="inline-flex gap-1 shrink-0">
      {btn("good", "👍", "border-emerald-500/60 bg-emerald-500/15 text-emerald-300")}
      {btn("bad", "👎", "border-red-500/60 bg-red-500/15 text-red-300")}
    </span>
  );
}

function ProbBar({ p }: { p: number }) {
  const on = p >= BRIEF_TICK_THRESHOLD;
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(p * 100)}%`, background: on ? "hsl(150 60% 45%)" : "hsl(225 10% 45%)" }}
        />
      </div>
      <span className="text-xs tabular-nums w-10 text-right" style={{ color: on ? "hsl(150 60% 55%)" : undefined }}>
        {p.toFixed(2)}
      </span>
    </div>
  );
}

function JudgeChip({ name, value }: { name: string; value: number | undefined }) {
  if (value === undefined) return null;
  const hot = value >= JUDGE_THRESHOLD;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] border tabular-nums ${
        hot ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-border text-muted-foreground"
      }`}
      title={`Jev: ${name} = ${value.toFixed(2)}`}
    >
      {name} {value.toFixed(2)}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    kept: "border-emerald-500/50 text-emerald-300 bg-emerald-500/10",
    reworded: "border-amber-500/50 text-amber-300 bg-amber-500/10",
    added: "border-sky-500/50 text-sky-300 bg-sky-500/10",
    deleted: "border-red-500/50 text-red-300 bg-red-500/10",
  };
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${map[status] ?? "border-border text-muted-foreground"}`}>
      {status}
    </span>
  );
}

// ── Detail ────────────────────────────────────────────────────────────

function CreationDetailView({
  detail,
  onLabel,
}: {
  detail: CreationDetail;
  onLabel: (targetKind: CreationLabel["targetKind"], targetKey: string, verdict: "good" | "bad" | "clear") => void;
}) {
  const [showEvents, setShowEvents] = useState(false);

  const labelFor = (kind: CreationLabel["targetKind"], key: string) =>
    detail.labels.find((l) => l.targetKind === kind && l.targetKey === key)?.verdict as "good" | "bad" | undefined;

  const byKind = useMemo(() => {
    const m: Record<string, CreationEventRecord[]> = {};
    for (const e of detail.events) (m[e.kind] ??= []).push(e);
    return m;
  }, [detail.events]);

  const briefSubmitted = byKind.brief_submitted?.[byKind.brief_submitted.length - 1]?.payload as
    | { mode?: string; source?: string; durationMs?: number; elapsedMs?: number; skipped?: boolean; ticks?: { id: string; elapsedMs: number }[] }
    | undefined;
  const tickMs = new Map<string, number>((briefSubmitted?.ticks ?? []).map((t) => [t.id, t.elapsedMs]));

  // Follow-ups: merge server (generated / judged) and client (answered) events by index.
  const followUps = useMemo(() => {
    const idxs = new Set<number>();
    for (const k of ["clarify_generated", "clarify_judged", "clarify_answered"]) {
      for (const e of byKind[k] ?? []) if (e.idx !== null) idxs.add(e.idx);
    }
    detail.clarifications.forEach((_, i) => idxs.add(i + 1));
    const find = (kind: string, idx: number) => (byKind[kind] ?? []).filter((e) => e.idx === idx).pop()?.payload;
    const checkpointAfter = (idx: number) => (byKind.checkpoint ?? []).filter((e) => e.idx === idx).map((e) => e.payload?.choice as string);
    return [...idxs]
      .sort((a, b) => a - b)
      .map((idx) => {
        const gen = find("clarify_generated", idx) as { question?: string; hint?: string | null; provider?: string; latencyMs?: number } | undefined;
        const judged = find("clarify_judged", idx) as { redundant?: number; misaddressed?: number; vague?: number; flagged?: boolean } | undefined;
        const answered = find("clarify_answered", idx) as { answer?: string; mode?: string; chars?: number } | undefined;
        const stored = detail.clarifications[idx - 1];
        return {
          idx,
          question: gen?.question ?? stored?.question ?? "(unknown question)",
          hint: gen?.hint ?? null,
          provider: gen?.provider,
          latencyMs: gen?.latencyMs,
          judged,
          answer: answered?.answer ?? stored?.answer ?? null,
          answerMode: answered?.mode,
          checkpoints: checkpointAfter(idx),
        };
      });
  }, [byKind, detail.clarifications]);

  const confirmTap = byKind.review_confirm_tapped?.[0]?.payload as
    | { timeOnScreenMs?: number; edits?: number; deletes?: number; adds?: number; reorders?: number }
    | undefined;
  const diff = detail.reviewDiff;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="font-display text-lg font-bold">{detail.title ?? "Untitled"}</h3>
        <span className="text-xs text-muted-foreground">{fmtDate(detail.createdAt)}</span>
        {detail.isTest && <span className="text-[11px] rounded-full border border-border px-2 py-0.5 text-muted-foreground">test</span>}
        <a className="text-xs text-primary hover:underline" href={`/s/${detail.code}`} target="_blank" rel="noreferrer">
          /s/{detail.code}
        </a>
        <a className="text-xs text-primary hover:underline" href={`/d/${detail.dashboardCode}`} target="_blank" rel="noreferrer">
          dashboard
        </a>
      </div>

      {/* Brief + Jev */}
      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Brief · Jev checklist{" "}
          {detail.briefEval?.provider && detail.briefEval.provider !== "typesafe" && (
            <span className="ml-2 text-amber-400 normal-case">(evaluated by {detail.briefEval.provider} fallback)</span>
          )}
        </h4>
        {detail.brief ? (
          <p className="text-sm leading-relaxed rounded-md border border-border bg-secondary/20 p-3 whitespace-pre-wrap">{detail.brief}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No brief (legacy two-question flow).</p>
        )}
        {briefSubmitted && (
          <p className="text-xs text-muted-foreground">
            {briefSubmitted.mode} · {briefSubmitted.source} · spoke {secs(briefSubmitted.durationMs)} · on screen {secs(briefSubmitted.elapsedMs)}
            {briefSubmitted.skipped && <span className="ml-2 text-amber-400">continued without all five</span>}
          </p>
        )}
        {detail.briefEval && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {BRIEF_CHECKLIST.map((item) => {
              const ev = detail.briefEval!.items.find((i) => i.id === item.id);
              const p = ev?.probability ?? 0;
              return (
                <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                  <span className={`w-5 text-center ${ev?.satisfied ? "text-emerald-400" : "text-muted-foreground"}`}>{ev?.satisfied ? "✓" : "○"}</span>
                  <span className="text-sm w-44 shrink-0">{item.label}</span>
                  <ProbBar p={p} />
                  <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">
                    {tickMs.has(item.id) ? `@${secs(tickMs.get(item.id))}` : ""}
                  </span>
                  <span className="flex-1" />
                  <Verdict size="xs" current={labelFor("brief_item", item.id)} onSet={(v) => onLabel("brief_item", item.id, v)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Follow-ups */}
      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Follow-ups · Cerebras, judged by Jev ({followUps.length})
        </h4>
        {followUps.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        <ol className="space-y-2">
          {followUps.map((f) => (
            <li key={f.idx} className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
              <div className="flex items-start gap-3">
                <span className="font-display text-xs text-primary/70 mt-1 w-4">{f.idx}</span>
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium">{f.question}</p>
                  {f.hint && <p className="text-xs text-muted-foreground">hint: {f.hint}</p>}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <JudgeChip name="redundant" value={f.judged?.redundant} />
                    <JudgeChip name="misaddressed" value={f.judged?.misaddressed} />
                    <JudgeChip name="vague" value={f.judged?.vague} />
                    {!f.judged && <span className="text-[11px] text-muted-foreground">not judged</span>}
                    {f.provider && (
                      <span className="text-[11px] text-muted-foreground">
                        · {f.provider} {f.latencyMs ? `${f.latencyMs} ms` : ""}
                      </span>
                    )}
                  </div>
                  {f.answer ? (
                    <p className="text-sm text-foreground/80 border-l-2 border-primary/40 pl-2 whitespace-pre-wrap">
                      {f.answer}
                      {f.answerMode && <span className="ml-2 text-[11px] text-muted-foreground">({f.answerMode})</span>}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">unanswered</p>
                  )}
                </div>
                <Verdict size="xs" current={labelFor("clarify", String(f.idx))} onSet={(v) => onLabel("clarify", String(f.idx), v)} />
              </div>
              {f.checkpoints.map((choice, i) => (
                <div key={i} className="ml-7 text-xs rounded border border-dashed border-border px-2 py-1 inline-block">
                  checkpoint → {choice === "continue" ? "Ask me more" : "Create agent"}
                </div>
              ))}
            </li>
          ))}
        </ol>
      </section>

      {/* Questions */}
      <section className="space-y-3">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Questions · generated vs. confirmed</h4>
        {diff ? (
          <>
            <p className="text-xs text-muted-foreground">
              {diff.generated} generated → {diff.final} confirmed · kept {diff.kept} · reworded {diff.reworded} · deleted {diff.deleted} · added {diff.added} · moved {diff.moved}
              {confirmTap && ` · ${secs(confirmTap.timeOnScreenMs)} on screen`}
            </p>
            <ol className="space-y-2">
              {diff.items.map((it, i) => {
                const key = it.finalIndex !== null ? String(it.finalIndex) : `g${it.generatedIndex}`;
                return (
                  <li key={i} className="rounded-md border border-border bg-secondary/20 p-3 flex items-start gap-3">
                    <span className="font-display text-xs text-primary/70 mt-1 w-4">{it.finalIndex !== null ? it.finalIndex + 1 : "–"}</span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={it.status} />
                        {it.status === "reworded" && <span className="text-[11px] text-muted-foreground tabular-nums">similarity {it.similarity.toFixed(2)}</span>}
                        {it.generatedIndex !== null && it.finalIndex !== null && it.generatedIndex !== it.finalIndex && (
                          <span className="text-[11px] text-muted-foreground">was #{it.generatedIndex + 1}</span>
                        )}
                      </div>
                      {it.status === "deleted" ? (
                        <p className="text-sm line-through text-muted-foreground">{it.generatedText}</p>
                      ) : it.status === "reworded" ? (
                        <>
                          <p className="text-xs line-through text-muted-foreground">{it.generatedText}</p>
                          <p className="text-sm">{it.finalText}</p>
                        </>
                      ) : (
                        <p className="text-sm">{it.finalText ?? it.generatedText}</p>
                      )}
                    </div>
                    <Verdict size="xs" current={labelFor("question", key)} onSet={(v) => onLabel("question", key, v)} />
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Not confirmed yet — showing what the model generated.</p>
            <ol className="space-y-2">
              {detail.generatedQuestions.map((q, i) => (
                <li key={i} className="rounded-md border border-border bg-secondary/20 p-3 flex items-start gap-3">
                  <span className="font-display text-xs text-primary/70 mt-1 w-4">{i + 1}</span>
                  <p className="text-sm flex-1">{q.text}</p>
                  <Verdict size="xs" current={labelFor("question", `g${i}`)} onSet={(v) => onLabel("question", `g${i}`, v)} />
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {/* Raw timeline */}
      <section>
        <button type="button" onClick={() => setShowEvents((s) => !s)} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
          {showEvents ? "Hide" : "Show"} raw timeline ({detail.events.length} events)
        </button>
        {showEvents && (
          <ol className="mt-2 space-y-1 text-xs font-mono">
            {detail.events.map((e) => (
              <li key={e.id} className="rounded border border-border bg-background px-2 py-1 overflow-x-auto">
                <span className="text-muted-foreground">{fmtDate(e.createdAt)}</span> <span className="text-primary">{e.kind}</span>
                {e.idx !== null && <span className="text-muted-foreground"> #{e.idx}</span>} <span className="text-muted-foreground">[{e.source}]</span>{" "}
                <span className="whitespace-pre-wrap break-all">{JSON.stringify(e.payload)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────

export default function CreationsPanel() {
  const [days, setDays] = useState(30);
  const [includeTest, setIncludeTest] = useState(false);
  const [stats, setStats] = useState<CreationStats | null>(null);
  const [list, setList] = useState<CreationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CreationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, l] = await Promise.all([fetchCreationStats(days, includeTest), fetchCreations({ limit: 100, includeTest })]);
      setStats(s);
      setList(l.creations);
    } catch (e: any) {
      captureException(e, { location: "CreationsPanel.load" });
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days, includeTest]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    fetchCreation(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        captureException(e, { location: "CreationsPanel.detail" });
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const handleLabel = async (targetKind: CreationLabel["targetKind"], targetKey: string, verdict: "good" | "bad" | "clear") => {
    if (!detail) return;
    try {
      const res = await labelCreation(detail.id, { targetKind, targetKey, verdict });
      setDetail({ ...detail, labels: res.labels });
      setList((prev) => prev.map((c) => (c.id === detail.id ? { ...c, labelCount: res.labels.length } : c)));
      setStats((prev) => prev); // precision refreshes on next load
    } catch (e: any) {
      captureException(e, { location: "CreationsPanel.label" });
      setError(e.message);
    }
  };

  const briefPrecision = useMemo(() => {
    const byItem = stats?.labels.byKind.brief_item ?? {};
    const entries = Object.entries(byItem);
    if (entries.length === 0) return null;
    const good = entries.reduce((s, [, v]) => s + v.good, 0);
    const bad = entries.reduce((s, [, v]) => s + v.bad, 0);
    return { good, bad, precision: good + bad ? good / (good + bad) : null };
  }, [stats]);

  return (
    <div className="p-6 space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-sm ${days === d ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {d}d
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
          include test traffic
        </label>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard label="Creations" value={String(stats.creations)} sub={`${stats.confirmed} confirmed`} />
          <StatCard
            label="Brief · skipped"
            value={pct(stats.brief.skipRate)}
            sub={`continued before 5 ticks · ${pct(stats.brief.voiceRate)} by voice · median ${secs(stats.brief.medianDurationMs)}`}
          />
          <StatCard
            label="Jev · time to tick"
            value={
              Object.values(stats.brief.meanTickMs).filter((v): v is number => v !== null).length
                ? secs(
                    Object.values(stats.brief.meanTickMs)
                      .filter((v): v is number => v !== null)
                      .reduce((a, b) => a + b, 0) / Object.values(stats.brief.meanTickMs).filter((v) => v !== null).length,
                  )
                : "–"
            }
            sub={BRIEF_CHECKLIST.map((i) => `${i.id} ${secs(stats.brief.meanTickMs[i.id])}`).join(" · ")}
          />
          <StatCard
            label="Follow-ups"
            value={num(stats.followUps.meanPerCreation)}
            sub={`per creation · "Ask me more" ${pct(stats.followUps.continueRate)} of ${stats.followUps.checkpoints} checkpoints`}
          />
          <StatCard
            label="Jev flagged follow-ups"
            value={pct(stats.followUps.flaggedRate)}
            sub={`of ${stats.followUps.judged} · redundant ${pct(stats.followUps.flagRates.redundant)} · misaddressed ${pct(stats.followUps.flagRates.misaddressed)} · vague ${pct(stats.followUps.flagRates.vague)}`}
          />
          <StatCard
            label="Questions kept as written"
            value={pct(stats.review.meanKeptRatio)}
            sub={`${pct(stats.review.changedRate)} changed something · reworded ${num(stats.review.meanReworded)} · deleted ${num(stats.review.meanDeleted)} · added ${num(stats.review.meanAdded)} · moved ${num(stats.review.meanMoved)}`}
          />
          <StatCard
            label="Labels"
            value={String(stats.labels.total)}
            sub={briefPrecision ? `brief ticks judged right ${pct(briefPrecision.precision)} (${briefPrecision.good}👍 ${briefPrecision.bad}👎)` : "none yet — open a creation and judge"}
          />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
        {/* List */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">When</th>
                <th className="text-left px-3 py-2 font-semibold">Title</th>
                <th className="text-left px-3 py-2 font-semibold">Brief</th>
                <th className="text-left px-3 py-2 font-semibold">Follow-ups</th>
                <th className="text-left px-3 py-2 font-semibold">Review</th>
                <th className="text-right px-3 py-2 font-semibold">Labels</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No creations yet.
                  </td>
                </tr>
              )}
              {list.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`cursor-pointer border-t border-border transition-colors ${selectedId === c.id ? "bg-primary/10" : "hover:bg-secondary/30"}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground text-xs">{fmtDate(c.createdAt)}</td>
                  <td className="px-3 py-2 max-w-[200px]">
                    <div className="truncate">{c.title ?? <span className="text-muted-foreground">untitled</span>}</div>
                    {c.isTest && <span className="text-[10px] text-muted-foreground">test</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {c.briefChars ? (
                      <>
                        <span className={c.briefSatisfied === 5 ? "text-emerald-400" : ""}>{c.briefSatisfied ?? "?"}/5</span>
                        <span className="text-muted-foreground"> · {c.briefChars}ch</span>
                        {c.briefSkipped && <span className="text-amber-400"> · skipped</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">legacy</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {c.clarificationCount}
                    {c.checkpointChoices.length > 0 && (
                      <span className="text-muted-foreground"> · {c.checkpointChoices.map((ch) => (ch === "continue" ? "more" : "create")).join(", ")}</span>
                    )}
                    {c.flaggedFollowUps > 0 && <span className="text-red-400"> · ⚑{c.flaggedFollowUps}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {c.review ? (
                      <>
                        <span className={c.review.keptRatio === 1 ? "text-emerald-400" : ""}>
                          {c.review.kept}/{c.review.generated} kept
                        </span>
                        {c.review.reworded > 0 && <span className="text-amber-400"> ✎{c.review.reworded}</span>}
                        {c.review.deleted > 0 && <span className="text-red-400"> −{c.review.deleted}</span>}
                        {c.review.added > 0 && <span className="text-sky-400"> +{c.review.added}</span>}
                        {c.review.moved > 0 && <span className="text-muted-foreground"> ↕{c.review.moved}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{c.generatedCount ? `${c.generatedCount} generated` : "–"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">{c.labelCount || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detail */}
        <div className="rounded-lg border border-border p-5 min-h-[200px]">
          {!selectedId && <p className="text-sm text-muted-foreground">Select a creation to see the brief, Jev's ticks, every follow-up with its judgement, and what changed on review.</p>}
          {selectedId && !detail && <p className="text-sm text-muted-foreground">Loading…</p>}
          {detail && <CreationDetailView detail={detail} onLabel={handleLabel} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Admin API for the Creations tab (parlo.me/admin → Creations).
 *
 * Lists every agent creation with what the models decided and what the
 * creator did about it, serves one creation's full story (brief + Jev
 * probabilities, follow-ups + Jev judgement, generated vs. confirmed
 * questions diff, client events), aggregates calibration stats, and stores
 * human verdicts (good / bad) per tick, follow-up, or question.
 *
 * Protected like the rest of /api/admin: Cloudflare Access in front of the
 * admin routes. The verdict author is taken from the Access email header.
 */

import { Hono } from "hono";
import type { Env, SurveyQuestion } from "../types";
import { generateId } from "../services/codes";
import { listCreationEvents, parseRow, type CreationEventRow } from "../services/creationLog";
import { trackServerEvent } from "../services/analytics";
import { CLARIFY_JUDGE_THRESHOLD } from "../services/clarifyJudge";
import type { ReviewDiff } from "../services/reviewDiff";

const adminCreations = new Hono<{ Bindings: Env; Variables: { isTest: boolean } }>();

type LabelKind = "brief_item" | "clarify" | "question";
const LABEL_KINDS = new Set<LabelKind>(["brief_item", "clarify", "question"]);
const VERDICTS = new Set(["good", "bad", "clear"]);

interface CreationRow {
  id: string;
  code: string;
  title: string | null;
  status: string;
  created_at: string;
  is_test: number;
  brief: string | null;
  brief_chars: number | null;
  brief_clarifications: string | null;
  brief_eval: string | null;
  generated_questions: string | null;
  review_diff: string | null;
  label_count: number;
}

interface LabelRow {
  id: string;
  survey_id: string;
  target_kind: LabelKind;
  target_key: string;
  verdict: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000;
}

function rate(hits: number, total: number): number | null {
  return total === 0 ? null : Math.round((hits / total) * 1000) / 1000;
}

// ── GET /api/admin/creations/stats?days=30&includeTest=0 ──
adminCreations.get("/api/admin/creations/stats", async (c) => {
  const db = c.env.DB;
  const days = Math.min(365, Math.max(1, parseInt(c.req.query("days") ?? "30", 10) || 30));
  const includeTest = c.req.query("includeTest") === "1";
  const since = new Date(Date.now() - days * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

  const surveysRes = await db
    .prepare(
      `SELECT id, created_at, brief, brief_clarifications, brief_eval, generated_questions, review_diff
       FROM surveys
       WHERE created_at >= ? AND (brief IS NOT NULL OR generated_questions IS NOT NULL) AND (? = 1 OR is_test = 0)`
    )
    .bind(since, includeTest ? 1 : 0)
    .all<Pick<CreationRow, "id" | "created_at" | "brief" | "brief_clarifications" | "brief_eval" | "generated_questions" | "review_diff">>();
  const surveyRows = surveysRes.results;
  const surveyIds = new Set(surveyRows.map((s) => s.id));

  const eventsRes = await db
    .prepare(
      `SELECT e.* FROM creation_events e
       JOIN surveys s ON s.id = e.survey_id
       WHERE e.created_at >= ? AND (? = 1 OR s.is_test = 0)
         AND e.kind IN ('brief_submitted', 'checkpoint', 'clarify_judged', 'clarify_answered', 'review_confirmed', 'regenerate', 'back')`
    )
    .bind(since, includeTest ? 1 : 0)
    .all<CreationEventRow>();
  const events = eventsRes.results.map(parseRow).map((e, i) => ({ ...e, surveyId: eventsRes.results[i].survey_id }));

  const labelsRes = await db
    .prepare(
      `SELECT l.* FROM creation_labels l
       JOIN surveys s ON s.id = l.survey_id
       WHERE l.created_at >= ? AND (? = 1 OR s.is_test = 0)`
    )
    .bind(since, includeTest ? 1 : 0)
    .all<LabelRow>();

  // ── Brief / Jev ──
  const briefSubmitted = events.filter((e) => e.kind === "brief_submitted");
  const skipped = briefSubmitted.filter((e) => (e.payload as any)?.skipped === true).length;
  const voiceMode = briefSubmitted.filter((e) => (e.payload as any)?.mode === "voice").length;
  const briefDurations = briefSubmitted
    .map((e) => (e.payload as any)?.durationMs)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const tickTimes: Record<string, number[]> = {};
  const finalProbs: Record<string, number[]> = {};
  for (const e of briefSubmitted) {
    const p = e.payload as any;
    for (const t of p?.ticks ?? []) {
      if (typeof t?.id === "string" && typeof t?.elapsedMs === "number") {
        (tickTimes[t.id] ??= []).push(t.elapsedMs);
      }
    }
    for (const item of p?.probabilities ?? []) {
      if (typeof item?.id === "string" && typeof item?.probability === "number") {
        (finalProbs[item.id] ??= []).push(item.probability);
      }
    }
  }

  // ── Follow-ups / Cerebras judged by Jev ──
  const judged = events.filter((e) => e.kind === "clarify_judged");
  const flagCounts = { redundant: 0, misaddressed: 0, vague: 0 };
  const judgeMeans = { redundant: [] as number[], misaddressed: [] as number[], vague: [] as number[] };
  for (const e of judged) {
    const p = e.payload as any;
    for (const k of ["redundant", "misaddressed", "vague"] as const) {
      if (typeof p?.[k] === "number") {
        judgeMeans[k].push(p[k]);
        if (p[k] >= CLARIFY_JUDGE_THRESHOLD) flagCounts[k]++;
      }
    }
  }
  const checkpoints = events.filter((e) => e.kind === "checkpoint");
  const continued = checkpoints.filter((e) => (e.payload as any)?.choice === "continue").length;
  const clarificationCounts = surveyRows.map((s) => parseJson<unknown[]>(s.brief_clarifications)?.length ?? 0);
  const answerChars = events
    .filter((e) => e.kind === "clarify_answered")
    .map((e) => (e.payload as any)?.chars)
    .filter((n): n is number => typeof n === "number");

  // ── Review / generation ──
  const diffs = surveyRows.map((s) => parseJson<ReviewDiff>(s.review_diff)).filter((d): d is ReviewDiff => !!d);
  const changed = diffs.filter((d) => d.kept !== d.generated || d.final !== d.generated || d.moved > 0).length;
  const regenerates = events.filter((e) => e.kind === "regenerate").length;

  // ── Labels ──
  const labelStats: Record<string, Record<string, { good: number; bad: number }>> = {};
  for (const l of labelsRes.results) {
    const byKind = (labelStats[l.target_kind] ??= {});
    const key = l.target_kind === "brief_item" ? l.target_key : "all";
    const entry = (byKind[key] ??= { good: 0, bad: 0 });
    if (l.verdict === "good") entry.good++;
    else if (l.verdict === "bad") entry.bad++;
  }

  return c.json({
    days,
    includeTest,
    creations: surveyRows.length,
    confirmed: diffs.length,
    brief: {
      submitted: briefSubmitted.length,
      skipRate: rate(skipped, briefSubmitted.length),
      voiceRate: rate(voiceMode, briefSubmitted.length),
      medianDurationMs: briefDurations.length ? briefDurations.sort((a, b) => a - b)[Math.floor(briefDurations.length / 2)] : null,
      meanTickMs: Object.fromEntries(Object.entries(tickTimes).map(([k, v]) => [k, mean(v)])),
      meanFinalProbability: Object.fromEntries(Object.entries(finalProbs).map(([k, v]) => [k, mean(v)])),
    },
    followUps: {
      meanPerCreation: mean(clarificationCounts),
      checkpoints: checkpoints.length,
      continueRate: rate(continued, checkpoints.length),
      judged: judged.length,
      flaggedRate: rate(judged.filter((e) => (e.payload as any)?.flagged === true).length, judged.length),
      flagRates: {
        redundant: rate(flagCounts.redundant, judged.length),
        misaddressed: rate(flagCounts.misaddressed, judged.length),
        vague: rate(flagCounts.vague, judged.length),
      },
      meanScores: {
        redundant: mean(judgeMeans.redundant),
        misaddressed: mean(judgeMeans.misaddressed),
        vague: mean(judgeMeans.vague),
      },
      meanAnswerChars: mean(answerChars),
      backPresses: events.filter((e) => e.kind === "back").length,
    },
    review: {
      confirmed: diffs.length,
      changedRate: rate(changed, diffs.length),
      meanKeptRatio: mean(diffs.map((d) => d.keptRatio)),
      meanSurvivedRatio: mean(diffs.map((d) => d.survivedRatio)),
      meanUntouchedRatio: mean(diffs.map((d) => d.untouchedRatio)),
      meanDeleted: mean(diffs.map((d) => d.deleted)),
      meanAdded: mean(diffs.map((d) => d.added)),
      meanReworded: mean(diffs.map((d) => d.reworded)),
      meanMoved: mean(diffs.map((d) => d.moved)),
      regenerates,
    },
    labels: {
      total: labelsRes.results.length,
      byKind: labelStats,
    },
    _surveyIds: surveyIds.size,
  });
});

// ── GET /api/admin/creations?limit=50&offset=0&includeTest=0 ──
adminCreations.get("/api/admin/creations", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const includeTest = c.req.query("includeTest") === "1";

  const rows = await db
    .prepare(
      `SELECT s.id, s.code, s.title, s.status, s.created_at, s.is_test,
              length(s.brief) AS brief_chars, s.brief_clarifications, s.brief_eval,
              s.generated_questions, s.review_diff,
              (SELECT COUNT(*) FROM creation_labels l WHERE l.survey_id = s.id) AS label_count
       FROM surveys s
       WHERE (s.brief IS NOT NULL OR s.generated_questions IS NOT NULL) AND (? = 1 OR s.is_test = 0)
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(includeTest ? 1 : 0, limit, offset)
    .all<Omit<CreationRow, "brief">>();

  const ids = rows.results.map((r) => r.id);
  const checkpointsBySurvey: Record<string, string[]> = {};
  const flagsBySurvey: Record<string, number> = {};
  const skippedBySurvey: Record<string, boolean> = {};
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const ev = await db
      .prepare(
        `SELECT survey_id, kind, payload FROM creation_events
         WHERE survey_id IN (${placeholders}) AND kind IN ('checkpoint', 'clarify_judged', 'brief_submitted')`
      )
      .bind(...ids)
      .all<{ survey_id: string; kind: string; payload: string | null }>();
    for (const e of ev.results) {
      const p = parseJson<any>(e.payload);
      if (e.kind === "checkpoint" && typeof p?.choice === "string") {
        (checkpointsBySurvey[e.survey_id] ??= []).push(p.choice);
      } else if (e.kind === "clarify_judged" && p?.flagged === true) {
        flagsBySurvey[e.survey_id] = (flagsBySurvey[e.survey_id] ?? 0) + 1;
      } else if (e.kind === "brief_submitted") {
        skippedBySurvey[e.survey_id] = p?.skipped === true;
      }
    }
  }

  const creations = rows.results.map((r) => {
    const diff = parseJson<ReviewDiff>(r.review_diff);
    const briefEval = parseJson<{ items: { id: string; satisfied: boolean; probability: number }[]; provider?: string }>(r.brief_eval);
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      status: r.status,
      createdAt: r.created_at,
      isTest: r.is_test === 1,
      briefChars: r.brief_chars ?? 0,
      briefSkipped: skippedBySurvey[r.id] ?? null,
      briefSatisfied: briefEval ? briefEval.items.filter((i) => i.satisfied).length : null,
      briefProvider: briefEval?.provider ?? null,
      clarificationCount: parseJson<unknown[]>(r.brief_clarifications)?.length ?? 0,
      checkpointChoices: checkpointsBySurvey[r.id] ?? [],
      flaggedFollowUps: flagsBySurvey[r.id] ?? 0,
      generatedCount: parseJson<unknown[]>(r.generated_questions)?.length ?? 0,
      review: diff
        ? { generated: diff.generated, final: diff.final, kept: diff.kept, reworded: diff.reworded, added: diff.added, deleted: diff.deleted, moved: diff.moved, keptRatio: diff.keptRatio }
        : null,
      labelCount: r.label_count,
    };
  });

  return c.json({ creations, limit, offset });
});

// ── GET /api/admin/creations/:id ──
adminCreations.get("/api/admin/creations/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const survey = await db
    .prepare(
      `SELECT id, code, dashboard_code, title, status, created_at, is_test, brief, brief_clarifications,
              brief_eval, generated_questions, review_diff
       FROM surveys WHERE id = ?`
    )
    .bind(id)
    .first<Record<string, any>>();
  if (!survey) return c.json({ error: "Creation not found" }, 404);

  const [questions, events, labels] = await Promise.all([
    db.prepare("SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order").bind(id).all<SurveyQuestion>(),
    listCreationEvents(db, id),
    db.prepare("SELECT * FROM creation_labels WHERE survey_id = ? ORDER BY created_at").bind(id).all<LabelRow>(),
  ]);

  return c.json({
    id: survey.id,
    code: survey.code,
    dashboardCode: survey.dashboard_code,
    title: survey.title,
    status: survey.status,
    createdAt: survey.created_at,
    isTest: survey.is_test === 1,
    brief: survey.brief,
    briefEval: parseJson(survey.brief_eval),
    clarifications: parseJson<{ question: string; answer: string }[]>(survey.brief_clarifications) ?? [],
    generatedQuestions: parseJson<{ text: string; hint?: string; type?: string }[]>(survey.generated_questions) ?? [],
    finalQuestions: questions.results.map((q) => ({ id: q.id, text: q.text, hint: q.hint, type: q.question_type ?? "voice", sortOrder: q.sort_order })),
    reviewDiff: parseJson<ReviewDiff>(survey.review_diff),
    events,
    labels: labels.results.map((l) => ({
      id: l.id,
      targetKind: l.target_kind,
      targetKey: l.target_key,
      verdict: l.verdict,
      note: l.note,
      createdBy: l.created_by,
      createdAt: l.created_at,
    })),
  });
});

// ── POST /api/admin/creations/:id/labels ── { targetKind, targetKey, verdict, note? }
adminCreations.post("/api/admin/creations/:id/labels", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req
    .json<{ targetKind?: string; targetKey?: string; verdict?: string; note?: string }>()
    .catch(() => null);

  if (!body || !LABEL_KINDS.has(body.targetKind as LabelKind) || typeof body.targetKey !== "string" || !body.targetKey) {
    return c.json({ error: "targetKind (brief_item | clarify | question) and targetKey are required" }, 400);
  }
  if (!VERDICTS.has(body.verdict ?? "")) {
    return c.json({ error: "verdict must be good, bad, or clear" }, 400);
  }

  const survey = await db.prepare("SELECT id FROM surveys WHERE id = ?").bind(id).first<{ id: string }>();
  if (!survey) return c.json({ error: "Creation not found" }, 404);

  const targetKind = body.targetKind as LabelKind;
  const targetKey = body.targetKey.slice(0, 64);
  const createdBy = c.req.header("cf-access-authenticated-user-email") ?? "admin";

  if (body.verdict === "clear") {
    await db
      .prepare("DELETE FROM creation_labels WHERE survey_id = ? AND target_kind = ? AND target_key = ?")
      .bind(id, targetKind, targetKey)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO creation_labels (id, survey_id, target_kind, target_key, verdict, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(survey_id, target_kind, target_key)
         DO UPDATE SET verdict = excluded.verdict, note = excluded.note, created_by = excluded.created_by, created_at = datetime('now')`
      )
      .bind(generateId(), id, targetKind, targetKey, body.verdict, body.note?.slice(0, 500) ?? null, createdBy)
      .run();
  }

  trackServerEvent(id, "creation_labeled", {
    surveyId: id,
    targetKind,
    targetKey,
    verdict: body.verdict,
    createdBy,
  });

  const labels = await db.prepare("SELECT * FROM creation_labels WHERE survey_id = ? ORDER BY created_at").bind(id).all<LabelRow>();
  return c.json({
    ok: true,
    labels: labels.results.map((l) => ({
      id: l.id,
      targetKind: l.target_kind,
      targetKey: l.target_key,
      verdict: l.verdict,
      note: l.note,
      createdBy: l.created_by,
      createdAt: l.created_at,
    })),
  });
});

export default adminCreations;

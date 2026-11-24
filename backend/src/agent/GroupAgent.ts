/**
 * GroupAgent — the agent that runs one parlo.
 *
 * One Durable Object per parlo (instance name = survey id). Its private
 * SQLite is the agent's file system: a `files` table of paths and text.
 * D1 stays the system of record for membership and responses; the agent
 * only ever sees transcripts and metadata (audio and video stay in R2).
 *
 * Files the agent keeps:
 *   /brief.md                 — the creator's brief + clarifications, and for a
 *                               study the living brief: the questions it must
 *                               answer with their status, and the team's open steers
 *   /questions.md             — every round's asks
 *   /members.md               — who is in the group (names and roles, no phones)
 *   /answers/round-N/<who>/<questionId>.md — one transcript per answer
 *   /report.md                — the group report members get back
 *   /memory.md                — the agent's own running notes
 *   /rounds/N-proposal.json   — what it proposed for round N and why
 *
 * Triggers:
 *   - ingestResponse(): called after transcription; schedules a digest
 *   - runDigest(): reads new answers, rewrites /report.md and /memory.md
 *   - proposeRound(): plans the next round (poll or probe) for owner approval
 *   - readBrief(): after a digest, reads the answers against the brief's
 *     questions (open / emerging / answered, with quotes) and suggests new ones
 *   - scheduleReplan(): the brief moved or someone steered; re-plan the next round
 *   - nightly cron at 03:00 UTC digests anything the debounce missed
 */

import { Agent } from "agents";
import { notifyReportReady } from "../services/reportReady";
import { sweepPendingTranscriptions } from "../services/transcription";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import type { Env, GroupRole, Round, RoundKind, SurveyQuestion } from "../types";
import { pickAgentModel, runOnAgentModel } from "./model";
import { initAnalytics, trackServerEvent } from "../services/analytics";
import { closesAtFor, repeatsOnClose, shapeReport, timingSpec } from "../services/shapes";
import { outputsAgentSection, parseOutputs } from "../services/outputs";
import { closeRound, createProposedRound, getRound, membersPendingFor, overdueRounds, roundAsks, sendRound, type ProposedAsk } from "../services/rounds";
import { applyAgentReading, briefForAgent, listItems, LIVE_STATUSES, logEvent, type AgentReading } from "../services/briefBoard";
import { judgePositive, POSITIVE_AT } from "../services/answerJudge";
import { notifyManagers, notifyUsers } from "../services/notify";
import { createWhatsAppClient } from "../services/whatsapp";
import { displayNameFor } from "../services/groups";
import { buildAnswersCsv } from "../services/exportCsv";

export interface GroupState {
  surveyId: string | null;
  title: string | null;
  answersIngested: number;
  ingestedSinceDigest: number;
  lastIngestAt: string | null;
  lastDigestAt: string | null;
  lastProposalAt: string | null;
  lastError: string | null;
  provider: string | null;
  model: string | null;
  /** The owner's dashboard code, so an OAuth callback can send them back to the Agent tab. */
  dashboardCode: string | null;
  /** Export to the connected destinations after every report. */
  autoExport: boolean;
  lastExportAt: string | null;
  lastExportSummary: string | null;
  lastExportError: string | null;
}

/** An MCP server the owner connected as an export destination. */
export interface AgentConnection {
  id: string;
  name: string;
  url: string;
  state: "authenticating" | "connecting" | "connected" | "discovering" | "ready" | "failed";
  tools: string[];
  error: string | null;
  /** Set while the owner still has to authorise the server. */
  authUrl: string | null;
}

export interface AddConnectionResult {
  id: string;
  state: AgentConnection["state"];
  authUrl: string | null;
  connection: AgentConnection | null;
}

export interface ExportResult {
  ok: boolean;
  summary: string | null;
  toolCalls: number;
  destinations: string[];
  provider: string;
  model: string;
  error?: string;
}

export interface IngestAnswer {
  questionId: string;
  questionText: string;
  roundNumber: number;
  kind: "voice" | "photo" | "video";
  transcript: string | null;
}

export interface IngestResponseInput {
  surveyId: string;
  responseId: string;
  userId: string | null;
  displayName: string | null;
  submittedAt: string | null;
  /** What the participant allowed beyond the study: none | quote | voice. */
  publishConsent?: string | null;
  answers: IngestAnswer[];
}

export interface AgentFile {
  path: string;
  updatedAt: string;
  bytes: number;
}

export interface AgentSnapshot {
  state: GroupState;
  files: AgentFile[];
  report: string | null;
  reportUpdatedAt: string | null;
  memory: string | null;
  connections: AgentConnection[];
}

export interface DigestResult {
  ok: boolean;
  report: string | null;
  answersRead: number;
  provider: string;
  model: string;
  error?: string;
}

export interface ProposalResult {
  ok: boolean;
  round?: Round;
  asks?: SurveyQuestion[];
  error?: string;
}

const MAX_ANSWER_CHARS = 6000;
const MAX_FILE_READ_CHARS = 12000;
const MAX_LOOP_STEPS = 14;
/** Reports are capped at ~500 words, but the loop also carries tool chatter. */
const MAX_OUTPUT_TOKENS = 4096;
const DIGEST_DEBOUNCE_SECONDS = 180;
/** A steer or a brief change re-plans the next round this long after the first one. */
const REPLAN_DEBOUNCE_SECONDS = 20;
/** How much answer text one reading of the brief may carry. */
const BRIEF_READ_CHARS = 70_000;

function nowIso() {
  return new Date().toISOString();
}

function slug(s: string) {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || "x";
}

/**
 * Some models (Workers AI Llama in particular) narrate a tool call as text
 * instead of invoking it. Pull any `write_file` calls out of the text so the
 * work isn't lost.
 */
function salvageWriteCalls(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = /\{\s*"name"\s*:\s*"write_file"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Find the matching closing brace by depth, respecting strings.
    let depth = 0;
    let inStr = false;
    let i = m.index;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const chunk = text.slice(m.index, i + 1);
    try {
      const obj = JSON.parse(chunk) as { parameters?: { path?: string; content?: string }; arguments?: { path?: string; content?: string } };
      const args = obj.parameters ?? obj.arguments;
      if (args?.path && typeof args.content === "string" && args.content.trim()) out.push({ path: args.path, content: args.content });
    } catch {
      // Truncated output: take the path and whatever of the content string made it.
      const pathM = chunk.match(/"path"\s*:\s*"([^"]+)"/);
      const contentM = chunk.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (pathM && contentM && contentM[1].length > 40) {
        const content = contentM[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
        out.push({ path: pathM[1], content: content + "\n\n_(the agent's output was cut short here)_" });
      }
    }
    re.lastIndex = i + 1;
  }
  return out;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

export class GroupAgent extends Agent<Env, GroupState> {
  initialState: GroupState = {
    surveyId: null,
    title: null,
    answersIngested: 0,
    ingestedSinceDigest: 0,
    lastIngestAt: null,
    lastDigestAt: null,
    lastProposalAt: null,
    lastError: null,
    provider: null,
    model: null,
    dashboardCode: null,
    autoExport: false,
    lastExportAt: null,
    lastExportSummary: null,
    lastExportError: null,
  };

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`;
    initAnalytics(this.env.POSTHOG_API_KEY, (p) => this.ctx.waitUntil(p));
    // Cron schedules are idempotent, so this is safe on every wake.
    await this.schedule("0 3 * * *", "runNightly");
    // After an MCP OAuth dance the provider lands on /api/mcp/callback/<id>,
    // the Worker forwards it here, and we send the owner back to the Agent tab.
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        const target = new URL(
          this.state.dashboardCode ? `/d/${this.state.dashboardCode}` : "/",
          this.env.FRONTEND_ORIGIN ?? "https://parlo.me",
        );
        target.searchParams.set("tab", "agent");
        target.searchParams.set("connection", result.authSuccess ? "connected" : "failed");
        if (!result.authSuccess) target.searchParams.set("reason", result.authError.slice(0, 160));
        return Response.redirect(target.toString(), 302);
      },
    });
  }

  // ── File system ────────────────────────────────────────────────────

  private writeFile(path: string, content: string) {
    this.sql`INSERT INTO files (path, content, updated_at) VALUES (${path}, ${content}, ${nowIso()})
      ON CONFLICT(path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`;
  }

  private readFile(path: string): { content: string; updatedAt: string } | null {
    const rows = this.sql<{ content: string; updated_at: string }>`SELECT content, updated_at FROM files WHERE path = ${path}`;
    return rows[0] ? { content: rows[0].content, updatedAt: rows[0].updated_at } : null;
  }

  private hasFile(path: string): boolean {
    return this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM files WHERE path = ${path}`[0]?.n > 0;
  }

  private listFiles(prefix = "/"): AgentFile[] {
    const like = `${prefix}%`;
    return this.sql<{ path: string; updated_at: string; bytes: number }>`
      SELECT path, updated_at, length(content) AS bytes FROM files WHERE path LIKE ${like} ORDER BY path ASC
    `.map((r) => ({ path: r.path, updatedAt: r.updated_at, bytes: r.bytes }));
  }

  private searchFiles(query: string): { path: string; snippet: string }[] {
    const like = `%${query.replace(/[%_]/g, "")}%`;
    return this.sql<{ path: string; content: string }>`
      SELECT path, content FROM files WHERE content LIKE ${like} ORDER BY path ASC LIMIT 25
    `.map((r) => {
      const i = r.content.toLowerCase().indexOf(query.toLowerCase());
      const from = Math.max(0, i - 120);
      return { path: r.path, snippet: r.content.slice(from, from + 320) };
    });
  }

  // ── Binding to a parlo ─────────────────────────────────────────────

  private bind(surveyId: string) {
    if (this.state.surveyId !== surveyId) {
      this.setState({ ...this.state, surveyId });
    }
  }

  private requireSurveyId(): string {
    const id = this.state.surveyId ?? this.name;
    if (!id) throw new Error("GroupAgent is not bound to a parlo");
    return id;
  }

  /**
   * Pull everything the agent should know from D1 into its file system.
   * Idempotent: answer files are only written once, the rest is rewritten.
   */
  private async syncFromD1(surveyId: string): Promise<{ answerFiles: number; newAnswers: number }> {
    const db = this.env.DB;
    const survey = await db
      .prepare("SELECT id, title, dashboard_code, brief, brief_clarifications, visibility, intro_transcript, output_shape, outputs, timing, sponsor_name FROM surveys WHERE id = ?")
      .bind(surveyId)
      .first<{ id: string; title: string | null; dashboard_code: string; brief: string | null; brief_clarifications: string | null; visibility: string; intro_transcript: string | null; output_shape: string | null; outputs: string | null; timing: string | null; sponsor_name: string | null }>();
    if (!survey) throw new Error("Parlo not found");

    // /brief.md
    let clarifications = "";
    try {
      const parsed = JSON.parse(survey.brief_clarifications ?? "[]") as { question: string; answer: string }[];
      clarifications = parsed.map((c, i) => `${i + 1}. Q: ${c.question}\n   A: ${c.answer}`).join("\n");
    } catch {
      clarifications = "";
    }
    const livingBrief = await briefForAgent(db, surveyId);
    this.writeFile(
      "/brief.md",
      [
        `# ${survey.title ?? "Untitled parlo"}`,
        "",
        `Visibility: ${survey.visibility === "open" ? "open group (members hear each other, with names)" : "private (only the owner, admins and the agent hear raw answers; members get the report)"}`,
        ...(survey.sponsor_name
          ? [
              "",
              `Sponsored study: ${survey.sponsor_name} commissioned it and their team also hears the raw answers. In everything you write, never name a participant: refer to people by their segment ("a customer", "two competitor users").`,
            ]
          : []),
        "",
        "## The creator's brief",
        survey.brief?.trim() || "(no brief recorded)",
        "",
        ...(livingBrief.length ? [...livingBrief, ""] : []),
        "## What should come back to the group",
        shapeReport(survey.output_shape) ?? "A report on what the group said.",
        "",
        "## Also make, after every round",
        outputsAgentSection(parseOutputs(survey.outputs)),
        "",
        "## Timing",
        timingSpec(survey.timing)?.brief ?? "(no deadline; the report updates as answers come in)",
        "",
        "## Clarifications",
        clarifications || "(none)",
        ...(survey.intro_transcript ? ["", "## The creator's voice hello (transcript)", survey.intro_transcript] : []),
      ].join("\n")
    );

    // /questions.md
    const rounds = await db
      .prepare("SELECT * FROM rounds WHERE survey_id = ? ORDER BY number ASC")
      .bind(surveyId)
      .all<Round>();
    const questions = await db
      .prepare(
        `SELECT q.*, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone
         FROM survey_questions q LEFT JOIN users u ON u.id = q.target_user_id
         WHERE q.survey_id = ? ORDER BY q.sort_order ASC`
      )
      .bind(surveyId)
      .all<SurveyQuestion & { first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null }>();
    const qLines: string[] = ["# Questions by round", ""];
    for (const r of rounds.results) {
      qLines.push(`## Round ${r.number} — ${r.kind} (${r.status})${r.rationale ? ` — ${r.rationale}` : ""}`);
      const qs = questions.results.filter((q) => q.round_id === r.id);
      if (qs.length === 0) qLines.push("(no asks yet)");
      for (const q of qs) {
        const target = q.target_user_id ? ` [for ${displayNameFor(q) ?? q.target_user_id} · ${q.target_user_id}]` : "";
        qLines.push(`- (${q.question_type}) ${q.text}${target}`);
      }
      qLines.push("");
    }
    this.writeFile("/questions.md", qLines.join("\n"));

    // /members.md — names and roles only, never phones
    const members = await db
      .prepare(
        `SELECT gm.user_id, gm.role, gm.joined_at, gm.segment, gm.descriptor, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone,
                (SELECT COUNT(*) FROM responses r WHERE r.survey_id = gm.survey_id AND r.user_id = gm.user_id AND r.status != 'in_progress') AS n
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.survey_id = ? AND gm.removed_at IS NULL ORDER BY gm.joined_at ASC`
      )
      .bind(surveyId)
      .all<{ user_id: string; role: GroupRole; joined_at: string; segment: string | null; descriptor: string | null; first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null; n: number }>();
    const cell = (v: string | null) => (v ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
    const clientTeam = members.results.filter((m) => m.role === "client");
    this.writeFile(
      "/members.md",
      [
        "# Members",
        "",
        "| id | name | role | segment | about | answers | joined |",
        "|---|---|---|---|---|---|---|",
        ...members.results
          .filter((m) => m.role !== "client")
          .map((m) => `| ${m.user_id} | ${cell(displayNameFor(m)) || "(no name yet)"} | ${m.role} | ${cell(m.segment)} | ${cell(m.descriptor)} | ${m.n} | ${m.joined_at.slice(0, 10)} |`),
        ...(clientTeam.length
          ? ["", "## The client's team", "They commissioned the study and steer it. They are not participants: never aim an ask at them.", ...clientTeam.map((m) => `- ${displayNameFor(m) ?? "(no name yet)"}`)]
          : []),
      ].join("\n")
    );

    // /answers/… — import transcribed answers we haven't filed yet
    const answers = await db
      .prepare(
        `SELECT ra.id, ra.question_id, ra.transcription, ra.transcription_status, ra.image_r2_key, ra.video_r2_key,
                r.id AS response_id, r.user_id, r.first_name AS r_first, r.last_name AS r_last, r.submitted_at, r.publish_consent,
                q.text AS question_text, q.question_type, rd.number AS round_number,
                u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone
         FROM response_answers ra
         JOIN responses r ON r.id = ra.response_id
         JOIN survey_questions q ON q.id = ra.question_id
         LEFT JOIN rounds rd ON rd.id = q.round_id
         LEFT JOIN users u ON u.id = r.user_id
         WHERE r.survey_id = ? AND r.status != 'in_progress' AND ra.transcription_status = 'completed'
         ORDER BY r.submitted_at ASC`
      )
      .bind(surveyId)
      .all<{
        id: string; question_id: string; transcription: string | null; transcription_status: string; image_r2_key: string | null; video_r2_key: string | null;
        response_id: string; user_id: string | null; r_first: string | null; r_last: string | null; submitted_at: string | null; publish_consent: string | null;
        question_text: string; question_type: "voice" | "photo" | "video"; round_number: number | null;
        first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null;
      }>();

    let newAnswers = 0;
    for (const a of answers.results) {
      const name = displayNameFor(a) ?? [a.r_first, a.r_last].filter(Boolean).join(" ") ?? null;
      const path = this.answerPath(a.round_number ?? 1, a.user_id, a.response_id, a.question_id);
      if (this.hasFile(path)) continue;
      this.writeFile(
        path,
        this.renderAnswer({
          who: name || "Anonymous",
          userId: a.user_id,
          responseId: a.response_id,
          roundNumber: a.round_number ?? 1,
          questionText: a.question_text,
          kind: a.question_type,
          transcript: a.transcription,
          submittedAt: a.submitted_at,
          publishConsent: a.publish_consent,
        })
      );
      newAnswers++;
    }

    if (survey.title !== this.state.title || survey.dashboard_code !== this.state.dashboardCode) {
      this.setState({ ...this.state, title: survey.title, dashboardCode: survey.dashboard_code });
    }
    return { answerFiles: this.listFiles("/answers/").length, newAnswers };
  }

  private answerPath(roundNumber: number, userId: string | null, responseId: string, questionId: string) {
    const who = userId ? slug(userId) : `anon-${slug(responseId)}`;
    return `/answers/round-${roundNumber}/${who}/${slug(questionId)}.md`;
  }

  private renderAnswer(a: {
    who: string;
    userId: string | null;
    responseId: string;
    roundNumber: number;
    questionText: string;
    kind: string;
    transcript: string | null;
    submittedAt: string | null;
    publishConsent?: string | null;
  }) {
    const body =
      a.transcript?.trim() ||
      (a.kind === "photo" ? "(photo answer — no transcript)" : a.kind === "video" ? "(video answer — no speech transcribed)" : "(no speech transcribed)");
    return [
      "---",
      `member: ${a.who}${a.userId ? ` (${a.userId})` : " (not signed in)"}`,
      `round: ${a.roundNumber}`,
      `question: ${a.questionText.replace(/\n/g, " ")}`,
      `kind: ${a.kind}`,
      `answered: ${a.submittedAt ?? "unknown"}`,
      `response: ${a.responseId}`,
      // What may leave the study: none, quote (their words, unnamed) or voice (the recording too).
      `publish: ${a.publishConsent === "quote" || a.publishConsent === "voice" ? a.publishConsent : "none"}`,
      "---",
      body.slice(0, MAX_ANSWER_CHARS),
    ].join("\n");
  }

  // ── Public API (called from the Worker over RPC) ───────────────────

  /** A response finished transcribing: file its answers and schedule a digest. */
  async ingestResponse(input: IngestResponseInput): Promise<{ filed: number }> {
    this.bind(input.surveyId);
    let filed = 0;
    for (const a of input.answers) {
      const path = this.answerPath(a.roundNumber, input.userId, input.responseId, a.questionId);
      if (this.hasFile(path)) continue;
      this.writeFile(
        path,
        this.renderAnswer({
          who: input.displayName || "Anonymous",
          userId: input.userId,
          responseId: input.responseId,
          roundNumber: a.roundNumber,
          questionText: a.questionText,
          kind: a.kind,
          transcript: a.transcript,
          submittedAt: input.submittedAt,
          publishConsent: input.publishConsent,
        })
      );
      filed++;
    }
    this.setState({
      ...this.state,
      answersIngested: this.state.answersIngested + filed,
      ingestedSinceDigest: this.state.ingestedSinceDigest + filed,
      lastIngestAt: nowIso(),
    });
    if (filed > 0) {
      // Debounced: one digest a few minutes after the first new answer.
      await this.schedule(DIGEST_DEBOUNCE_SECONDS, "runDigest", undefined, { idempotent: true });
    }
    return { filed };
  }

  /** Nightly safety net: digest if anything arrived that the debounce missed; close any round whose alarm was lost. */
  async runNightly() {
    const surveyId = this.state.surveyId;
    if (!surveyId) return;
    for (const r of await overdueRounds(this.env.DB, surveyId)) await this.closeRound({ roundId: r.id });
    try {
      await sweepPendingTranscriptions(this.env, { surveyId, limit: 10 });
    } catch (err) {
      console.error("[agent] transcription sweep failed", { surveyId, err });
    }
    if (this.state.ingestedSinceDigest > 0) await this.runDigest();
  }

  // ── Round deadlines ────────────────────────────────────────────────
  //
  // A timed parlo (the third chip row on the sentence screen: a deadline, or
  // the check-in cadence) closes each sent round at `rounds.closes_at`. The
  // Worker sets the date when a round goes out (go-live, approve) and asks
  // the agent to hold the alarm: one nudge to whoever has not answered a
  // little before, then the close, which files the report and, for a
  // cadence, proposes the next round straight away.

  /** Hold the alarms for a sent round: replaces any earlier ones for the same round. */
  async scheduleClose(surveyId: string, roundId: string, closesAtIso: string): Promise<{ closesAt: string; nudgeAt: string | null }> {
    this.bind(surveyId);
    await this.cancelRoundAlarms(roundId);
    const closesAt = new Date(closesAtIso);
    const survey = await this.env.DB.prepare("SELECT timing FROM surveys WHERE id = ?").bind(surveyId).first<{ timing: string | null }>();
    const lead = timingSpec(survey?.timing)?.nudgeLeadMs ?? null;
    const nudgeAt = lead ? new Date(closesAt.getTime() - lead) : null;
    const now = Date.now();
    if (nudgeAt && nudgeAt.getTime() > now + 60_000) await this.schedule(nudgeAt, "nudgeRound", { roundId });
    await this.schedule(closesAt.getTime() > now ? closesAt : new Date(now + 1000), "closeRound", { roundId });
    return { closesAt: closesAt.toISOString(), nudgeAt: nudgeAt?.toISOString() ?? null };
  }

  private async cancelRoundAlarms(roundId: string) {
    const all = (await this.listSchedules()) as { id: string; callback: string; payload?: unknown }[];
    for (const s of all) {
      if (s.callback !== "closeRound" && s.callback !== "nudgeRound") continue;
      if ((s.payload as { roundId?: string } | undefined)?.roundId !== roundId) continue;
      await this.cancelSchedule(s.id);
    }
  }

  /** A little before the close: remind the members the round is still waiting on. */
  async nudgeRound(payload: { roundId: string }) {
    const surveyId = this.requireSurveyId();
    const round = await getRound(this.env.DB, payload.roundId);
    if (!round || round.status !== "sent") return;
    const survey = await this.env.DB
      .prepare("SELECT code, title FROM surveys WHERE id = ?")
      .bind(surveyId)
      .first<{ code: string; title: string | null }>();
    if (!survey) return;
    const pending = await membersPendingFor(this.env.DB, surveyId, round);
    if (pending.length === 0) return;
    const title = survey.title ?? "your parlo";
    await notifyUsers(
      this.env.DB,
      pending.map((m) => m.user_id),
      {
        type: "new_round",
        title: `Round ${round.number} of ${title} closes soon`,
        body: "Tap to answer by voice before the agent writes the report.",
        surveyId,
        surveyTitle: survey.title,
      }
    );
    // The same template that opened the round: it is the one Meta has seen,
    // and its call to action ("Answer now", the personal link) is the nudge.
    const wa = createWhatsAppClient(this.env.KAPSO_API_KEY, this.env.WHATSAPP_PHONE_NUMBER_ID);
    for (const m of pending) {
      if (!m.phone) continue;
      try {
        await wa.sendTemplate(m.phone, "parlo_new_round", [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "survey_title", text: title },
              { type: "text", parameter_name: "round_number", text: String(round.number) },
            ],
          },
          { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: `${survey.code}?t=${m.access_token}` }] },
        ]);
      } catch (err) {
        console.error("[GroupAgent] nudge send failed", err);
      }
    }
    trackServerEvent(surveyId, "round_nudged", { surveyId, round: round.number, pending: pending.length });
  }

  /** The deadline: no more answers, the report lands, and a check-in proposes its next round. */
  async closeRound(payload: { roundId: string }) {
    const surveyId = this.requireSurveyId();
    const round = await getRound(this.env.DB, payload.roundId);
    if (!round || round.survey_id !== surveyId) return;
    const pending = round.status === "sent" ? await membersPendingFor(this.env.DB, surveyId, round) : [];
    if (!(await closeRound(this.env.DB, round.id))) return;
    trackServerEvent(surveyId, "round_closed", { surveyId, round: round.number, kind: round.kind, pending: pending.length });

    const digest = await this.runDigest();
    const survey = await this.env.DB.prepare("SELECT timing FROM surveys WHERE id = ?").bind(surveyId).first<{ timing: string | null }>();
    const repeats = repeatsOnClose(survey?.timing);
    await notifyManagers(this.env, surveyId, {
      type: "report_ready",
      title: `Round ${round.number} of ${this.state.title ?? "your parlo"} closed`,
      body: pending.length
        ? `${pending.length} ${pending.length === 1 ? "person" : "people"} did not answer. ${digest.ok && digest.report ? "The report is in." : "No report yet."}`
        : digest.ok && digest.report
          ? "Everyone answered. The report is in."
          : "No answers came in.",
      surveyId,
      surveyTitle: this.state.title,
    });

    if (repeats) {
      // The check-in: the next round goes out by itself, same asks, no tap
      // (decided 2026-10-25). The owner is told, and can still edit the
      // cadence or close the parlo.
      const proposal = await this.proposeRound(surveyId, {
        preferKind: "poll",
        hint: `This is a recurring check-in (${survey?.timing}). Propose the next round with the same asks as round ${round.number}, word for word, so the rounds compare.`,
      });
      if (proposal.ok && proposal.round) await this.sendProposedRound(surveyId, proposal.round.id);
    }
  }

  /** Send a round the agent just proposed, as if the owner had approved it. */
  private async sendProposedRound(surveyId: string, roundId: string) {
    const round = await getRound(this.env.DB, roundId);
    if (!round || round.status !== "proposed") return;
    const survey = await this.env.DB
      .prepare("SELECT id, code, title, timing FROM surveys WHERE id = ?")
      .bind(surveyId)
      .first<{ id: string; code: string; title: string | null; timing: string | null }>();
    if (!survey) return;
    const asks = await roundAsks(this.env.DB, round.id);
    if (asks.length === 0) return;
    const sent = await sendRound(this.env, survey, round, asks, null);
    await sent.sendMessages();
    if (sent.closesAt) await this.scheduleClose(surveyId, round.id, sent.closesAt.toISOString());
    trackServerEvent(surveyId, "round_auto_sent", { surveyId, round: round.number, kind: round.kind, recipients: sent.recipients.length });
    await notifyManagers(this.env, surveyId, {
      type: "new_round",
      title: `Round ${round.number} of ${survey.title ?? "your parlo"} went out`,
      body: `The check-in's next round, sent to ${sent.recipients.length} ${sent.recipients.length === 1 ? "person" : "people"}. Same asks as last time.`,
      surveyId,
      surveyTitle: survey.title,
    });
  }

  /** What the owner's dashboard shows. */
  async getSnapshot(surveyId: string): Promise<AgentSnapshot> {
    this.bind(surveyId);
    try {
      await this.syncFromD1(surveyId);
    } catch (err) {
      console.error("[GroupAgent] sync failed", err);
    }
    const report = this.readFile("/report.md");
    const memory = this.readFile("/memory.md");
    return {
      state: this.state,
      files: this.listFiles("/"),
      report: report?.content ?? null,
      reportUpdatedAt: report?.updatedAt ?? null,
      memory: memory?.content ?? null,
      connections: await this.connectionsSettled(1500),
    };
  }

  async readAgentFile(surveyId: string, path: string): Promise<{ path: string; content: string; updatedAt: string } | null> {
    this.bind(surveyId);
    const f = this.readFile(path);
    return f ? { path, ...f } : null;
  }

  // ── Exports: MCP destinations the owner connects ───────────────────

  private connectionsNow(): AgentConnection[] {
    const { servers, tools } = this.getMcpServers();
    return Object.entries(servers).map(([id, srv]) => ({
      id,
      name: srv.name,
      url: srv.server_url,
      state: srv.state,
      tools: tools.filter((t) => t.serverId === id).map((t) => t.name),
      error: srv.error ?? null,
      authUrl: srv.state === "authenticating" ? srv.auth_url : null,
    }));
  }

  /** Connections restored after hibernation take a moment to come back; give them one. */
  private async connectionsSettled(timeoutMs: number): Promise<AgentConnection[]> {
    await this.mcp.waitForConnections({ timeout: timeoutMs });
    return this.connectionsNow();
  }

  async listConnections(surveyId: string): Promise<AgentConnection[]> {
    this.bind(surveyId);
    return this.connectionsSettled(3000);
  }

  /**
   * Connect an MCP server over HTTP (a Zapier/Pipedream/Composio MCP URL, a
   * Google Sheets server, anything speaking MCP). The SDK stores the
   * registration and any OAuth tokens in this agent's SQLite. If the server
   * wants OAuth the result carries `authUrl`: the browser completes it and the
   * provider redirects to /api/mcp/callback/<surveyId>, which the Worker
   * forwards to this agent.
   */
  async addConnection(surveyId: string, input: { name: string; url: string; callbackHost: string }): Promise<AddConnectionResult> {
    this.bind(surveyId);
    const result = await this.addMcpServer(input.name, input.url, {
      id: slug(input.name).toLowerCase(),
      callbackHost: input.callbackHost,
      callbackPath: `/api/mcp/callback/${surveyId}`,
    });
    trackServerEvent(surveyId, "agent_connection_added", { surveyId, state: result.state, host: new URL(input.url).host });
    return {
      id: result.id,
      state: result.state,
      authUrl: result.state === "authenticating" ? result.authUrl : null,
      connection: this.connectionsNow().find((c) => c.id === result.id) ?? null,
    };
  }

  async removeConnection(surveyId: string, id: string): Promise<{ ok: true }> {
    this.bind(surveyId);
    await this.removeMcpServer(id);
    trackServerEvent(surveyId, "agent_connection_removed", { surveyId });
    return { ok: true };
  }

  async setAutoExport(surveyId: string, enabled: boolean): Promise<{ autoExport: boolean }> {
    this.bind(surveyId);
    this.setState({ ...this.state, autoExport: enabled });
    return { autoExport: enabled };
  }

  /** Scheduled a few seconds after each digest when the owner turned auto-export on. */
  async runAutoExport() {
    const surveyId = this.state.surveyId;
    if (!surveyId || !this.state.autoExport) return;
    if (!(await this.connectionsSettled(10_000)).some((c) => c.state === "ready")) return;
    await this.runExport(surveyId, { trigger: "auto" });
  }

  /**
   * Push the report and the answers table to the connected destination(s).
   * The model gets the destinations' own tools plus the read-only file tools
   * and decides which calls to make; the outcome is filed under /exports/.
   */
  async runExport(surveyId: string, opts: { instruction?: string; trigger?: "manual" | "auto" } = {}): Promise<ExportResult> {
    this.bind(surveyId);
    let picked = pickAgentModel(this.env);
    const started = Date.now();
    const trigger = opts.trigger ?? "manual";
    let destinations: string[] = [];
    try {
      await this.syncFromD1(surveyId);
      const ready = (await this.connectionsSettled(10_000)).filter((c) => c.state === "ready");
      destinations = ready.map((c) => c.name);
      if (ready.length === 0) throw new Error("No destination is connected yet. Add one under Exports first.");
      const mcpTools = this.mcp.getAITools({ state: "ready" });
      const toolNames = Object.keys(mcpTools);
      if (toolNames.length === 0) throw new Error(`${destinations.join(", ")} offers no tools to export with.`);
      const tools = { ...this.buildTools({ readOnly: true }), ...mcpTools };

      const title = this.state.title ?? "Untitled parlo";
      const report = this.readFile("/report.md")?.content ?? "(no report yet — the agent has not written one)";
      const csv = await buildAnswersCsv(this.env.DB, surveyId);

      const system = [
        "You are the agent running a Parlo: a group conversation where members answer by voice. Right now your job is to EXPORT this parlo's data to the destination(s) the owner connected, using their tools.",
        "Export, in this order: (1) the current report, as a document, page or note titled after the parlo; (2) the answers table below (CSV, one row per answer, keep the columns as given), as a spreadsheet, table or database rows. If the destination only suits one of the two, export the one it suits.",
        "Read the tool list first and pick the fewest calls that get the data there. If a tool can find an existing document or sheet named after this parlo, update that one instead of making another.",
        "The destination belongs to the owner, so member first names are fine. There are no phone numbers in your files; never invent any.",
        "When finished, reply with two to four plain sentences for the owner: what you exported, where (include any link a tool returned), and anything that failed. If nothing could be exported, say exactly why.",
      ].join("\n");

      const prompt = [
        `# ${title}`,
        `Destinations connected: ${destinations.join(", ")}`,
        `Their tools: ${toolNames.join(", ")}`,
        opts.instruction ? `Owner's instruction: ${opts.instruction.slice(0, 600)}` : "",
        "",
        "## Report (markdown)",
        report,
        "",
        "## Answers (CSV)",
        csv.slice(0, 60_000),
        "",
        "Export now.",
      ].join("\n");

      const ran = await runOnAgentModel(this.env, (m) =>
        generateText({
          model: m.model,
          system,
          prompt,
          tools,
          stopWhen: stepCountIs(MAX_LOOP_STEPS),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        })
      );
      const result = ran.result;
      picked = ran.picked;

      const toolCalls = result.steps.reduce((n, st) => n + st.toolCalls.filter((tc) => tc.toolName in mcpTools).length, 0);
      const ok = toolCalls > 0;
      const summary =
        result.text.trim() ||
        (ok ? `Exported with ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}.` : "The agent did not use any destination tool.");
      const stamp = nowIso();
      this.writeFile(
        `/exports/${stamp.replace(/[:.]/g, "-")}.md`,
        [
          `# Export ${stamp}`,
          `trigger: ${trigger}`,
          `destinations: ${destinations.join(", ")}`,
          `destination tool calls: ${toolCalls}`,
          `model: ${picked.provider} / ${picked.modelId}`,
          "",
          summary,
        ].join("\n")
      );
      this.setState({
        ...this.state,
        lastExportAt: stamp,
        lastExportSummary: summary.slice(0, 1000),
        lastExportError: ok ? null : summary.slice(0, 500),
        provider: picked.provider,
        model: picked.modelId,
      });

      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: `agent-export-${surveyId}-${started}`,
        $ai_model: picked.modelId,
        $ai_provider: picked.provider,
        $ai_input: `[export to ${destinations.join(", ")}; ${toolNames.length} tools]`,
        $ai_output_choices: [{ message: { content: summary.slice(0, 4000) } }],
        $ai_latency: (Date.now() - started) / 1000,
        $ai_input_tokens: result.usage?.inputTokens,
        $ai_output_tokens: result.usage?.outputTokens,
        $ai_is_error: !ok,
        surveyId,
        trigger,
        toolCalls,
      });
      trackServerEvent(surveyId, "agent_export_completed", { surveyId, ok, trigger, toolCalls, destinations: destinations.length, provider: picked.provider });

      return { ok, summary, toolCalls, destinations, provider: picked.provider, model: picked.modelId, error: ok ? undefined : summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[GroupAgent] export failed", message);
      this.setState({ ...this.state, lastExportError: message.slice(0, 500) });
      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: `agent-export-${surveyId}-${started}`,
        $ai_model: picked.modelId,
        $ai_provider: picked.provider,
        $ai_is_error: true,
        $ai_error: message,
        $ai_latency: (Date.now() - started) / 1000,
        surveyId,
        trigger,
      });
      return { ok: false, summary: null, toolCalls: 0, destinations, provider: picked.provider, model: picked.modelId, error: message };
    }
  }

  // ── Digest: rewrite the report from everything on file ─────────────

  async runDigest(): Promise<DigestResult> {
    const surveyId = this.requireSurveyId();
    let picked = pickAgentModel(this.env);
    const started = Date.now();
    try {
      const { answerFiles } = await this.syncFromD1(surveyId);
      if (answerFiles === 0) {
        return { ok: true, report: null, answersRead: 0, provider: picked.provider, model: picked.modelId };
      }

      const brief = this.readFile("/brief.md")?.content ?? "";
      const previousReport = this.readFile("/report.md")?.content ?? null;
      const memory = this.readFile("/memory.md")?.content ?? null;
      const answerPaths = this.listFiles("/answers/").map((f) => f.path);
      let wroteReport = false;

      const tools = this.buildTools({
        onWrite: (path) => {
          if (path === "/report.md") wroteReport = true;
        },
      });

      const system = [
        "You are the agent running a Parlo: a group conversation where members answer by voice and you, the agent, gather the answers, follow up, and report back.",
        "You have a small file system. Read what you need with the tools, then WRITE the report with write_file. Never invent answers that are not on file.",
        "Raw answers are private to the owner, admins and you. The report goes to every member, so write it for them: what the group said, where people agree, where they differ, memorable lines (quote briefly, attribute by first name only if the group is open, otherwise keep quotes unattributed), and what is still unclear.",
        "The brief says what should come back to the group (a post, testimonials, whether an idea holds up, why customers chose them, feedback, a decision, ideas…): give the report that shape, and make the opening paragraph answer it directly.",
        "When it asks for a post, the report opens with that post, ready to copy to LinkedIn: a hook line, the best lines from the answers, under 1,300 characters, no hashtags. The usual summary and sections follow it.",
        "Each answer file carries a `publish:` line. Anything written to be published outside the group (a post, a testimonial, a public quote) may only quote answers marked `publish: quote` or `publish: voice`; an answer marked `publish: none` informs the report and is never quoted in public material.",
        "Write in the creator's language and tone. Markdown, headed sections, under 500 words. Start with a one-paragraph summary.",
        "If the brief has a section \"Questions this study must answer\", this is a research study: after the summary give one section per question (the question as the heading) saying what was found, from how many people, and where segments differ, then a last section \"Not yet known\" listing what the answers cannot settle. Up to 800 words then. If the brief says the study is sponsored, never name a participant; refer to them by segment.",
        "Also keep /memory.md: your own running notes about this group (threads to follow, who has not answered, hypotheses). Replace it each time; keep it under 300 words.",
      ].join("\n");

      const prompt = [
        "## Brief",
        brief,
        "",
        `## Answers on file (${answerPaths.length}) — read them with read_file`,
        answerPaths.join("\n"),
        "",
        previousReport ? "## Previous report (improve it; do not just append)\n" + previousReport : "## No report yet — this is the first one.",
        "",
        memory ? "## Your notes from last time\n" + memory : "",
        "",
        "Now: read the answers (all of them if there are fewer than 40, otherwise the newest rounds first and search for themes), write /report.md, then write /memory.md. Finish with one sentence saying what changed.",
      ].join("\n");

      const ran = await runOnAgentModel(this.env, (m) =>
        generateText({
          model: m.model,
          system,
          prompt,
          tools,
          stopWhen: stepCountIs(MAX_LOOP_STEPS),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        })
      );
      const result = ran.result;
      picked = ran.picked;

      console.log(
        `[GroupAgent] digest steps=${result.steps.length} toolCalls=${result.steps.reduce((n, st) => n + st.toolCalls.length, 0)} wroteReport=${wroteReport} textChars=${result.text.length}`
      );

      // Weaker models sometimes narrate the tool call, or the report itself,
      // instead of calling write_file. Salvage either.
      if (!wroteReport) {
        const text = result.text.trim();
        for (const w of salvageWriteCalls(text)) {
          const p = w.path.startsWith("/") ? w.path : `/${w.path}`;
          if (p === "/report.md" || p === "/memory.md" || p.startsWith("/notes/")) {
            this.writeFile(p, w.content.slice(0, 40_000));
            if (p === "/report.md") wroteReport = true;
          }
        }
        if (!wroteReport && text.length > 80 && !text.startsWith("{")) {
          this.writeFile("/report.md", text);
          wroteReport = true;
        }
      }
      // And sometimes the tool IS called, with the narrated call as its content.
      for (const p of ["/report.md", "/memory.md"]) {
        const f = this.readFile(p);
        if (f && f.content.trimStart().startsWith("{")) {
          const inner = salvageWriteCalls(f.content).find((w) => (w.path.startsWith("/") ? w.path : `/${w.path}`) === p);
          if (inner) this.writeFile(p, inner.content.slice(0, 40_000));
        }
      }

      const report = this.readFile("/report.md");
      await this.env.DB.prepare("UPDATE surveys SET report_md = ?, report_updated_at = ? WHERE id = ?")
        .bind(report?.content ?? null, report?.updatedAt ?? null, surveyId)
        .run();
      // The living brief: what each question's status is now, with quotes.
      try {
        await this.readBrief(surveyId);
      } catch (err) {
        console.error("[agent] readBrief failed", { surveyId, err });
      }
      // Members who answered on WhatsApp (or verified a phone) get the report
      // in their thread, once per round. Fails quietly until the template is approved.
      if (report?.content) {
        try {
          await notifyReportReady(this.env, surveyId);
        } catch (err) {
          console.error("[agent] notifyReportReady failed", { surveyId, err });
        }
      }

      this.setState({
        ...this.state,
        lastDigestAt: nowIso(),
        ingestedSinceDigest: 0,
        lastError: null,
        provider: picked.provider,
        model: picked.modelId,
      });

      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: `agent-digest-${surveyId}-${started}`,
        $ai_model: picked.modelId,
        $ai_provider: picked.provider,
        $ai_input: `[group digest: ${answerPaths.length} answers]`,
        $ai_output_choices: report ? [{ message: { content: report.content.slice(0, 4000) } }] : [],
        $ai_latency: (Date.now() - started) / 1000,
        $ai_input_tokens: result.usage?.inputTokens,
        $ai_output_tokens: result.usage?.outputTokens,
        $ai_is_error: false,
        surveyId,
        steps: result.steps.length,
      });
      trackServerEvent(surveyId, "agent_digest_completed", { surveyId, answers: answerPaths.length, provider: picked.provider });

      if (this.state.autoExport) {
        await this.schedule(5, "runAutoExport", undefined, { idempotent: true });
      }

      await notifyManagers(this.env, surveyId, {
        type: "report_ready",
        title: `Your agent updated the report for ${this.state.title ?? "your parlo"}`,
        body: report?.content.slice(0, 160) ?? null,
        surveyId,
        surveyTitle: this.state.title,
      });

      return { ok: true, report: report?.content ?? null, answersRead: answerPaths.length, provider: picked.provider, model: picked.modelId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[GroupAgent] digest failed", message);
      this.setState({ ...this.state, lastError: message });
      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: `agent-digest-${surveyId}-${started}`,
        $ai_model: picked.modelId,
        $ai_provider: picked.provider,
        $ai_is_error: true,
        $ai_error: message,
        $ai_latency: (Date.now() - started) / 1000,
        surveyId,
      });
      return { ok: false, report: null, answersRead: 0, provider: picked.provider, model: picked.modelId, error: message };
    }
  }

  // ── Propose the next round ─────────────────────────────────────────


  /**
   * Who a testimonial round asks, and with which words.
   *
   * The people are not the planner's choice: every participant who has said
   * anything is read against "were they clearly positive?" (and about what the
   * owner's note names), and anyone asked for a testimonial before in this
   * study is left alone. The planner only supplies wording: its personal ask
   * for a person it singled out, else its general one.
   */
  private async testimonialAsks(
    surveyId: string,
    drafted: ProposedAsk[],
    general: ProposedAsk | null,
    hint?: string
  ): Promise<{ asks: ProposedAsk[]; rationale: string }> {
    const db = this.env.DB;
    const [said, asked] = await Promise.all([
      db
        .prepare(
          `SELECT r.user_id, group_concat(ra.transcription, ' ') AS said, MAX(r.submitted_at) AS last_at
           FROM response_answers ra
           JOIN responses r ON r.id = ra.response_id
           JOIN group_members gm ON gm.survey_id = r.survey_id AND gm.user_id = r.user_id
           WHERE r.survey_id = ? AND r.status != 'in_progress' AND gm.role = 'member' AND gm.removed_at IS NULL
             AND ra.transcription IS NOT NULL AND trim(ra.transcription) != ''
           GROUP BY r.user_id ORDER BY last_at DESC LIMIT 120`
        )
        .bind(surveyId)
        .all<{ user_id: string; said: string | null }>(),
      // One testimonial ask per person per study: answered, pending or declined, they are not asked again.
      db
        .prepare(
          `SELECT DISTINCT q.target_user_id AS user_id FROM survey_questions q JOIN rounds rd ON rd.id = q.round_id
           WHERE q.survey_id = ? AND rd.purpose = 'testimonial' AND rd.status IN ('sent', 'closed') AND q.target_user_id IS NOT NULL`
        )
        .bind(surveyId)
        .all<{ user_id: string }>(),
    ]);
    const already = new Set(asked.results.map((r) => r.user_id));
    const fresh = said.results.filter((r) => !already.has(r.user_id));
    const personal = new Map(drafted.filter((a) => !!a.targetUserId).map((a) => [a.targetUserId as string, a]));

    // Ten at a time: one judgment per person, and a Worker has a ceiling on parallel calls.
    const positive: string[] = [];
    for (let i = 0; i < fresh.length; i += 10) {
      const batch = fresh.slice(i, i + 10);
      const scores = await judgePositive(this.env, batch.map((r) => ({ said: r.said ?? "" })), hint);
      batch.forEach((r, j) => {
        const score = scores[j];
        // No judge reachable: only then does the planner's own pick stand.
        if (score === null ? personal.has(r.user_id) : score >= POSITIVE_AT) positive.push(r.user_id);
      });
    }
    if (positive.length === 0) {
      throw new Error(
        already.size > 0
          ? "Nobody new to ask: everyone who was clearly positive has already been asked for a testimonial."
          : "Nobody in the study has been clearly positive yet, so there is nobody to ask for a testimonial."
      );
    }
    const fallback: ProposedAsk = general ?? {
      text: "In a sentence or two, in your own words: what would you tell a peer about your experience?",
      hint: null,
      type: "voice",
      targetUserId: null,
    };
    const asks = positive.slice(0, 60).map((userId) => ({ ...(personal.get(userId) ?? fallback), targetUserId: userId }));
    const about = hint?.trim() ? ` (looking for: ${hint.trim().slice(0, 160)})` : "";
    const rationale =
      `${asks.length} ${asks.length === 1 ? "person" : "people"} sounded clearly positive${about} and ${asks.length === 1 ? "has" : "have"} not been asked before. ` +
      "Each is asked for one line they are happy to see used in public.";
    return { asks, rationale };
  }
  async proposeRound(
    surveyId: string,
    opts: {
      preferKind?: RoundKind;
      hint?: string;
      /** 'testimonial': ask the people who were positive for a line meant for public use. */
      purpose?: "testimonial";
      /** What the round pays per accepted answer (for a testimonial, the bonus); default the study's. */
      rewardCents?: number;
    } = {}
  ): Promise<ProposalResult> {
    this.bind(surveyId);
    let picked = pickAgentModel(this.env);
    const started = Date.now();
    try {
      await this.syncFromD1(surveyId);
      const brief = this.readFile("/brief.md")?.content ?? "";
      const questions = this.readFile("/questions.md")?.content ?? "";
      const members = this.readFile("/members.md")?.content ?? "";
      const report = this.readFile("/report.md")?.content ?? "(no report yet)";
      const memory = this.readFile("/memory.md")?.content ?? "";
      const answerPaths = this.listFiles("/answers/").map((f) => f.path);

      const memberRows = await this.env.DB.prepare(
        `SELECT gm.user_id FROM group_members gm WHERE gm.survey_id = ? AND gm.removed_at IS NULL AND gm.role != 'client'
         AND EXISTS (SELECT 1 FROM responses r WHERE r.survey_id = gm.survey_id AND r.user_id = gm.user_id AND r.status != 'in_progress')`
      )
        .bind(surveyId)
        .all<{ user_id: string }>();
      const answeredIds = new Set(memberRows.results.map((m) => m.user_id));

      // Participants by segment, so a round can be aimed at one ("segment:Customer").
      const segmentRows = await this.env.DB.prepare(
        "SELECT user_id, segment FROM group_members WHERE survey_id = ? AND removed_at IS NULL AND role = 'member' AND segment IS NOT NULL AND trim(segment) != ''"
      )
        .bind(surveyId)
        .all<{ user_id: string; segment: string }>();
      const bySegment = new Map<string, string[]>();
      for (const r of segmentRows.results) {
        const key = r.segment.trim().toLowerCase();
        bySegment.set(key, [...(bySegment.get(key) ?? []), r.user_id]);
      }
      const liveItemIds = new Set((await listItems(this.env.DB, surveyId)).filter((i) => LIVE_STATUSES.includes(i.status)).map((i) => i.id));
      const pricing = await this.env.DB.prepare("SELECT reward_cents FROM surveys WHERE id = ?").bind(surveyId).first<{ reward_cents: number | null }>();

      const tools = this.buildTools({ readOnly: true });

      const system = [
        "You are the agent running a Parlo: a group conversation where members answer by voice. You plan the next ROUND of asks for the owner to approve.",
        "Two kinds of round: a POLL sends the same 1–3 asks to everyone (comparable answers, good for aggregating); a PROBE sends one personal follow-up each to specific members who already answered (depth). Pick whichever moves the creator's goal forward most.",
        "Asks are spoken aloud by the member, so write them warm, conversational, one idea each, under 25 words. Never repeat an ask already on file. A probe must reference something that member actually said.",
        "When the brief lists \"Questions this study must answer\" (each with an id in square brackets and a status) and steers from the team that no round has taken up: aim this round at the steers first, then at the open and emerging questions. Leave answered questions alone unless a steer says otherwise. Say in the rationale which steer or question the round follows, and list the ids of the questions it digs into in \"serves\".",
        "Members may carry a segment in /members.md. To ask one segment only, give an ask the target \"segment:<name>\" with the name exactly as written there; everyone in that segment gets it, whether or not they have answered before.",
        "Respond ONLY with JSON: {\"kind\":\"poll\"|\"probe\",\"rationale\":\"one or two sentences for the owner\",\"serves\":[\"<brief question id>\"],\"asks\":[{\"text\":\"…\",\"hint\":\"short nudge or null\",\"target\":\"all\"|\"<member id>\"|\"segment:<name>\"}]}. Poll asks use target \"all\"; probe asks use a member id from /members.md who has answered, or a segment.",
        ...(opts.purpose === "testimonial"
          ? [
              "THIS ROUND ASKS FOR TESTIMONIALS, and only that. Who is asked is decided separately, from each participant's own words (the ones who were clearly positive, the owner's note may say about what, and who have not been asked before). Your job is the wording.",
              "First write ONE ask with target \"all\": the general invitation, used for anyone you did not write a personal one for. It must not refer to anything one person said. Then, for each participant whose answers you read and who was clearly positive, write one personal ask aimed at their member id (never a segment) that starts from what that person actually said they liked, so it reads as a follow-up and not a script.",
              "Each ask invites one or two sentences, in their own words and in the first person, that could be quoted in public: what they would tell a peer, or what the thing they praised did for them. Do not put words in their mouth and do not ask for anything they did not express. Under 25 words.",
              "They are told on the ask that the recording may be used in marketing and that it pays a bonus, so do not repeat that in the wording.",
            ]
          : []),
      ].join("\n");

      const prompt = [
        "## Brief",
        brief,
        "",
        "## Questions so far",
        questions,
        "",
        "## Members",
        members,
        "",
        "## Current report",
        report,
        "",
        memory ? "## Your notes\n" + memory + "\n" : "",
        `## Answers on file (${answerPaths.length}) — read_file any you need for probes`,
        answerPaths.slice(0, 80).join("\n"),
        "",
        opts.preferKind ? `The owner asked for a ${opts.preferKind} round.` : "",
        opts.hint ? `The owner's note: ${opts.hint}` : "",
        "",
        "Plan the next round and reply with the JSON only.",
      ].join("\n");

      const ran = await runOnAgentModel(this.env, (m) =>
        generateText({
          model: m.model,
          system,
          prompt,
          tools,
          stopWhen: stepCountIs(10),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        })
      );
      const result = ran.result;
      picked = ran.picked;

      const parsed = JSON.parse(extractJson(result.text)) as {
        kind?: string;
        rationale?: string;
        serves?: unknown;
        asks?: { text?: string; hint?: string | null; target?: string }[];
      };
      // One ask per person it is aimed at: a member id, or everyone in a segment.
      const drafted: ProposedAsk[] = [];
      /** The first ask written for everyone (a testimonial round uses it for people the planner did not single out). */
      let general: ProposedAsk | null = null;
      for (const a of parsed.asks ?? []) {
        if (typeof a.text !== "string" || !a.text.trim()) continue;
        const base = {
          text: a.text.trim().slice(0, 500),
          hint: typeof a.hint === "string" && a.hint.trim() ? a.hint.trim().slice(0, 120) : null,
          type: "voice" as const,
        };
        const target = a.target && a.target !== "all" ? a.target.trim() : null;
        const segment = target?.match(/^segment:\s*(.+)$/i)?.[1]?.trim().toLowerCase();
        if (segment) {
          for (const userId of bySegment.get(segment) ?? []) drafted.push({ ...base, targetUserId: userId });
        } else {
          if (!target) general ??= { ...base, targetUserId: null };
          drafted.push({ ...base, targetUserId: target && answeredIds.has(target) ? target : null });
        }
      }
      const targeted = drafted.filter((a) => !!a.targetUserId);
      // Anything aimed at someone makes the round a probe; a probe carries only aimed asks.
      // A testimonial round is always aimed: nobody is asked for a public line by broadcast.
      const kind: RoundKind =
        opts.purpose === "testimonial" || parsed.kind === "probe" || (targeted.length > 0 && targeted.length === drafted.length) ? "probe" : "poll";
      let asks: ProposedAsk[] = kind === "probe" ? targeted.slice(0, 60) : drafted.map((a) => ({ ...a, targetUserId: null })).slice(0, 3);
      let testimonialRationale: string | null = null;
      if (opts.purpose === "testimonial") {
        const chosen = await this.testimonialAsks(surveyId, drafted, general, opts.hint);
        asks = chosen.asks;
        testimonialRationale = chosen.rationale;
      }
      if (asks.length === 0) {
        throw new Error(
          opts.purpose === "testimonial"
            ? "Nobody in the study has been clearly positive yet, so there is nobody to ask for a testimonial."
            : "The agent did not produce any usable asks"
        );
      }
      const serves = Array.isArray(parsed.serves) ? parsed.serves.filter((id): id is string => typeof id === "string" && liveItemIds.has(id)).slice(0, 8) : [];

      const created = await createProposedRound(this.env.DB, surveyId, {
        kind,
        rationale: testimonialRationale ?? (typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 600) : null),
        proposedBy: "agent",
        asks,
        serves,
        // The study's default price per touch (for a testimonial, the bonus given); a researcher changes it before sending.
        rewardCents: opts.rewardCents ?? pricing?.reward_cents ?? null,
        purpose: opts.purpose ?? null,
      });
      if (liveItemIds.size > 0) {
        await logEvent(this.env.DB, surveyId, { type: "round_proposed", actorRole: "agent", roundId: created.round.id, body: created.round.rationale });
      }
      this.writeFile(
        `/rounds/${created.round.number}-proposal.json`,
        JSON.stringify({ round: created.round, asks: created.asks, proposedAt: nowIso(), provider: picked.provider, model: picked.modelId }, null, 2)
      );
      this.setState({ ...this.state, lastProposalAt: nowIso(), lastError: null, provider: picked.provider, model: picked.modelId });

      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: `agent-propose-${surveyId}-${started}`,
        $ai_model: picked.modelId,
        $ai_provider: picked.provider,
        $ai_input: `[round proposal: ${answerPaths.length} answers on file]`,
        $ai_output_choices: [{ message: { content: result.text.slice(0, 4000) } }],
        $ai_latency: (Date.now() - started) / 1000,
        $ai_input_tokens: result.usage?.inputTokens,
        $ai_output_tokens: result.usage?.outputTokens,
        $ai_is_error: false,
        surveyId,
        kind,
        asks: asks.length,
      });
      trackServerEvent(surveyId, "agent_round_proposed", { surveyId, round: created.round.number, kind, asks: asks.length });

      await notifyManagers(this.env, surveyId, {
        type: "round_proposed",
        title: `Your agent proposed round ${created.round.number} (${kind}) for ${this.state.title ?? "your parlo"}`,
        body: created.round.rationale,
        surveyId,
        surveyTitle: this.state.title,
      });

      return { ok: true, round: created.round, asks: created.asks };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[GroupAgent] proposal failed", message);
      this.setState({ ...this.state, lastError: message });
      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: `agent-propose-${surveyId}-${started}`,
        $ai_model: picked.modelId,
        $ai_provider: picked.provider,
        $ai_is_error: true,
        $ai_error: message,
        $ai_latency: (Date.now() - started) / 1000,
        surveyId,
      });
      return { ok: false, error: message };
    }
  }

  // ── The living brief ───────────────────────────────────────────────

  /** The brief moved, or someone steered: re-plan the next round shortly (several changes in a row make one plan). */
  async scheduleReplan(surveyId: string): Promise<{ scheduled: true }> {
    this.bind(surveyId);
    await this.schedule(REPLAN_DEBOUNCE_SECONDS, "replan", undefined, { idempotent: true });
    return { scheduled: true };
  }

  async replan() {
    const surveyId = this.requireSurveyId();
    // A question added a moment ago has not been read against the answers yet.
    await this.readBrief(surveyId).catch((err) => console.error("[GroupAgent] readBrief before replan failed", err));
    // A testimonial round someone asked for is waiting to be sent: a steer does not get to replace it.
    const waiting = await this.env.DB.prepare("SELECT 1 FROM rounds WHERE survey_id = ? AND status = 'proposed' AND purpose = 'testimonial' LIMIT 1").bind(surveyId).first();
    if (waiting) return;
    const result = await this.proposeRound(surveyId, {});
    if (!result.ok) console.error("[GroupAgent] replan failed", result.error);
  }

  /**
   * Read the answers against the brief. For every question the study must
   * answer: is it open, emerging or answered, what is the answer in a
   * sentence, who spoke to it, and up to three verbatim quotes. Also: what
   * do people keep raising that the brief does not ask? One JSON call, no
   * tools, so it behaves the same on every model the agent can fall back to.
   */
  async readBrief(surveyId: string): Promise<{ ok: boolean; moved: number; suggested: number; error?: string }> {
    this.bind(surveyId);
    const db = this.env.DB;
    const items = (await listItems(db, surveyId)).filter((i) => LIVE_STATUSES.includes(i.status));
    if (items.length === 0) return { ok: true, moved: 0, suggested: 0 };

    const rows = await db
      .prepare(
        `SELECT ra.id, ra.transcription, r.id AS response_id, r.user_id, q.text AS question_text, rd.number AS round_number, gm.segment
         FROM response_answers ra
         JOIN responses r ON r.id = ra.response_id
         JOIN survey_questions q ON q.id = ra.question_id
         LEFT JOIN rounds rd ON rd.id = q.round_id
         LEFT JOIN group_members gm ON gm.survey_id = r.survey_id AND gm.user_id = r.user_id
         WHERE r.survey_id = ? AND r.status != 'in_progress' AND ra.transcription_status = 'completed'
           AND ra.transcription IS NOT NULL AND length(trim(ra.transcription)) > 0
         ORDER BY r.submitted_at DESC, q.sort_order ASC LIMIT 240`
      )
      .bind(surveyId)
      .all<{ id: string; transcription: string; response_id: string; user_id: string | null; question_text: string; round_number: number | null; segment: string | null }>();
    if (rows.results.length === 0) return { ok: true, moved: 0, suggested: 0 };

    // Short handles the model can cite: A7 is an answer, P3 a person.
    const refToAnswer = new Map<string, string>();
    const personOf = new Map<string, string>();
    const lines: string[] = [];
    let chars = 0;
    for (const a of rows.results) {
      const personKey = a.user_id ?? `anon-${a.response_id}`;
      if (!personOf.has(personKey)) personOf.set(personKey, `P${personOf.size + 1}`);
      const ref = `A${refToAnswer.size + 1}`;
      const line = `${ref} | ${personOf.get(personKey)}${a.segment ? ` (${a.segment})` : ""} | round ${a.round_number ?? 1} | asked: ${a.question_text.replace(/\s+/g, " ").slice(0, 200)} | said: ${a.transcription.replace(/\s+/g, " ").slice(0, 1500)}`;
      if (chars + line.length > BRIEF_READ_CHARS) break;
      chars += line.length;
      refToAnswer.set(ref, a.id);
      lines.push(line);
    }

    let picked = pickAgentModel(this.env);
    const started = Date.now();
    const system = [
      "You are the analyst on a research study. The team keeps a short list of the questions the study must answer. Your job is to say, honestly, how far the answers collected so far go on each one.",
      "Be strict. \"answered\": several people speak to it and they agree, or they split in a way you can describe. \"emerging\": a pattern with thin support, one to three people. \"open\": nothing solid yet.",
      "Never invent. A finding is one plain sentence a client could read aloud; where segments differ, say how. Quotes are verbatim from the answer you cite, under 25 words.",
      "A suggestion is a question the brief does not ask yet that at least two people raised without being asked. None is fine.",
      "Respond ONLY with JSON.",
    ].join("\n");
    const prompt = [
      "## The questions (id, current status, text)",
      ...items.map((i) => `[${i.id}] (${i.status}) ${i.text}`),
      "",
      `## Answers (${lines.length}; ref | person (segment) | round | asked | said)`,
      ...lines,
      "",
      'Reply with JSON: {"items":[{"id":"<question id>","status":"open"|"emerging"|"answered","finding":"one sentence, or null when open with nothing to say","people":["P1","P4"],"evidence":[{"ref":"A3","quote":"verbatim, short"}]}],"suggestions":[{"text":"a question worth adding","why":"one sentence","people":["P2","P5"]}]}',
      "Every question appears once in items. At most three pieces of evidence each.",
    ].join("\n");

    try {
      const ran = await runOnAgentModel(this.env, (m) => generateText({ model: m.model, system, prompt, maxOutputTokens: MAX_OUTPUT_TOKENS }));
      const result = ran.result;
      picked = ran.picked;
      const parsed = JSON.parse(extractJson(result.text)) as {
        items?: { id?: string; status?: string; finding?: string | null; people?: unknown; evidence?: { ref?: string; quote?: string }[] }[];
        suggestions?: { text?: string; why?: string; people?: unknown }[];
      };
      const people = (v: unknown) => (Array.isArray(v) ? new Set(v.filter((p): p is string => typeof p === "string" && /^P\d+$/.test(p))).size : 0);
      const known = new Set(items.map((i) => i.id));
      const reading: AgentReading = {
        items: (parsed.items ?? [])
          .filter((i) => typeof i.id === "string" && known.has(i.id))
          .map((i) => ({
            id: i.id as string,
            status: i.status === "answered" ? "answered" : i.status === "emerging" ? "emerging" : "open",
            finding: typeof i.finding === "string" && i.finding.trim() ? i.finding.trim() : null,
            voices: people(i.people),
            evidence: (i.evidence ?? [])
              .map((e) => ({ answerId: e.ref ? refToAnswer.get(e.ref.trim()) : undefined, quote: typeof e.quote === "string" ? e.quote.trim().slice(0, 300) : "" }))
              .filter((e): e is { answerId: string; quote: string } => !!e.answerId && e.quote.length > 0),
          })),
        suggestions: (parsed.suggestions ?? [])
          .filter((s) => typeof s.text === "string" && people(s.people) >= 2)
          .map((s) => ({ text: (s.text as string).trim().slice(0, 280), why: typeof s.why === "string" ? s.why.trim() : null, voices: people(s.people) })),
      };
      const applied = await applyAgentReading(db, surveyId, reading);

      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: `agent-brief-${surveyId}-${started}`,
        $ai_model: picked.modelId,
        $ai_provider: picked.provider,
        $ai_input: `[brief reading: ${items.length} questions, ${lines.length} answers]`,
        $ai_output_choices: [{ message: { content: result.text.slice(0, 4000) } }],
        $ai_latency: (Date.now() - started) / 1000,
        $ai_input_tokens: result.usage?.inputTokens,
        $ai_output_tokens: result.usage?.outputTokens,
        $ai_is_error: false,
        surveyId,
      });
      trackServerEvent(surveyId, "agent_brief_read", { surveyId, questions: items.length, answers: lines.length, ...applied });
      return { ok: true, ...applied };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[GroupAgent] brief reading failed", message);
      trackServerEvent("parlo-ai", "$ai_generation", {
        $ai_trace_id: `agent-brief-${surveyId}-${started}`,
        $ai_model: picked.modelId,
        $ai_provider: picked.provider,
        $ai_is_error: true,
        $ai_error: message,
        $ai_latency: (Date.now() - started) / 1000,
        surveyId,
      });
      return { ok: false, moved: 0, suggested: 0, error: message };
    }
  }

  // ── Tools the model gets ───────────────────────────────────────────

  private buildTools(opts: { readOnly?: boolean; onWrite?: (path: string) => void } = {}) {
    const listTool = tool({
      description: "List files in the agent's file system. Pass a path prefix such as /answers/ or /answers/round-2/.",
      inputSchema: z.object({ prefix: z.string().default("/") }),
      execute: async ({ prefix }) => this.listFiles(prefix.startsWith("/") ? prefix : `/${prefix}`).map((f) => `${f.path} (${f.bytes} bytes, ${f.updatedAt})`),
    });
    const readTool = tool({
      description: "Read one file by exact path.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const f = this.readFile(path.startsWith("/") ? path : `/${path}`);
        return f ? f.content.slice(0, MAX_FILE_READ_CHARS) : `No such file: ${path}`;
      },
    });
    const readManyTool = tool({
      description: "Read several files at once (up to 12 paths). Use this to go through answers quickly.",
      inputSchema: z.object({ paths: z.array(z.string()).max(12) }),
      execute: async ({ paths }) =>
        paths.map((p) => {
          const path = p.startsWith("/") ? p : `/${p}`;
          const f = this.readFile(path);
          return `### ${path}\n${f ? f.content.slice(0, 3000) : "(missing)"}`;
        }).join("\n\n"),
    });
    const searchTool = tool({
      description: "Search file contents for a word or phrase. Returns matching paths with a snippet.",
      inputSchema: z.object({ query: z.string().min(2) }),
      execute: async ({ query }) => this.searchFiles(query),
    });
    const base = { list_files: listTool, read_file: readTool, read_files: readManyTool, search_files: searchTool };
    if (opts.readOnly) return base;

    const writeTool = tool({
      description: "Write a file. You may only write /report.md, /memory.md and files under /notes/.",
      inputSchema: z.object({ path: z.string(), content: z.string().min(1) }),
      execute: async ({ path, content }) => {
        const p = path.startsWith("/") ? path : `/${path}`;
        if (p !== "/report.md" && p !== "/memory.md" && !p.startsWith("/notes/")) {
          return `Refused: ${p} is read-only. Write /report.md, /memory.md or /notes/*.`;
        }
        this.writeFile(p, content.slice(0, 40_000));
        opts.onWrite?.(p);
        return `Wrote ${p} (${content.length} chars)`;
      },
    });
    return { ...base, write_file: writeTool };
  }
}

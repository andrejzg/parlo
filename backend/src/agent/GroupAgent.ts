/**
 * GroupAgent — the agent that runs one parlo.
 *
 * One Durable Object per parlo (instance name = survey id). Its private
 * SQLite is the agent's file system: a `files` table of paths and text.
 * D1 stays the system of record for membership and responses; the agent
 * only ever sees transcripts and metadata (audio and video stay in R2).
 *
 * Files the agent keeps:
 *   /brief.md                 — the creator's brief + clarifications
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
 *   - nightly cron at 03:00 UTC digests anything the debounce missed
 */

import { Agent } from "agents";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import type { Env, GroupRole, Round, RoundKind, SurveyQuestion } from "../types";
import { pickAgentModel } from "./model";
import { initAnalytics, trackServerEvent } from "../services/analytics";
import { createProposedRound, type ProposedAsk } from "../services/rounds";
import { notifyManagers } from "../services/notify";
import { displayNameFor } from "../services/groups";

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
      .prepare("SELECT id, title, brief, brief_clarifications, visibility, intro_transcript FROM surveys WHERE id = ?")
      .bind(surveyId)
      .first<{ id: string; title: string | null; brief: string | null; brief_clarifications: string | null; visibility: string; intro_transcript: string | null }>();
    if (!survey) throw new Error("Parlo not found");

    // /brief.md
    let clarifications = "";
    try {
      const parsed = JSON.parse(survey.brief_clarifications ?? "[]") as { question: string; answer: string }[];
      clarifications = parsed.map((c, i) => `${i + 1}. Q: ${c.question}\n   A: ${c.answer}`).join("\n");
    } catch {
      clarifications = "";
    }
    this.writeFile(
      "/brief.md",
      [
        `# ${survey.title ?? "Untitled parlo"}`,
        "",
        `Visibility: ${survey.visibility === "open" ? "open group (members hear each other, with names)" : "private (only the owner, admins and the agent hear raw answers; members get the report)"}`,
        "",
        "## The creator's brief",
        survey.brief?.trim() || "(no brief recorded)",
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
        `SELECT gm.user_id, gm.role, gm.joined_at, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone,
                (SELECT COUNT(*) FROM responses r WHERE r.survey_id = gm.survey_id AND r.user_id = gm.user_id AND r.status != 'in_progress') AS n
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.survey_id = ? AND gm.removed_at IS NULL ORDER BY gm.joined_at ASC`
      )
      .bind(surveyId)
      .all<{ user_id: string; role: GroupRole; joined_at: string; first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null; n: number }>();
    this.writeFile(
      "/members.md",
      [
        "# Members",
        "",
        "| id | name | role | answers | joined |",
        "|---|---|---|---|---|",
        ...members.results.map((m) => `| ${m.user_id} | ${displayNameFor(m) ?? "(no name yet)"} | ${m.role} | ${m.n} | ${m.joined_at.slice(0, 10)} |`),
      ].join("\n")
    );

    // /answers/… — import transcribed answers we haven't filed yet
    const answers = await db
      .prepare(
        `SELECT ra.id, ra.question_id, ra.transcription, ra.transcription_status, ra.image_r2_key, ra.video_r2_key,
                r.id AS response_id, r.user_id, r.first_name AS r_first, r.last_name AS r_last, r.submitted_at,
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
        response_id: string; user_id: string | null; r_first: string | null; r_last: string | null; submitted_at: string | null;
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
        })
      );
      newAnswers++;
    }

    if (survey.title !== this.state.title) this.setState({ ...this.state, title: survey.title });
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

  /** Nightly safety net: digest if anything arrived that the debounce missed. */
  async runNightly() {
    if (!this.state.surveyId) return;
    if (this.state.ingestedSinceDigest > 0) await this.runDigest();
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
    };
  }

  async readAgentFile(surveyId: string, path: string): Promise<{ path: string; content: string; updatedAt: string } | null> {
    this.bind(surveyId);
    const f = this.readFile(path);
    return f ? { path, ...f } : null;
  }

  // ── Digest: rewrite the report from everything on file ─────────────

  async runDigest(): Promise<DigestResult> {
    const surveyId = this.requireSurveyId();
    const picked = pickAgentModel(this.env);
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
        "Write in the creator's language and tone. Markdown, headed sections, under 500 words. Start with a one-paragraph summary.",
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

      const result = await generateText({
        model: picked.model,
        system,
        prompt,
        tools,
        stopWhen: stepCountIs(MAX_LOOP_STEPS),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });

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

  async proposeRound(surveyId: string, opts: { preferKind?: RoundKind; hint?: string } = {}): Promise<ProposalResult> {
    this.bind(surveyId);
    const picked = pickAgentModel(this.env);
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
        `SELECT gm.user_id FROM group_members gm WHERE gm.survey_id = ? AND gm.removed_at IS NULL
         AND EXISTS (SELECT 1 FROM responses r WHERE r.survey_id = gm.survey_id AND r.user_id = gm.user_id AND r.status != 'in_progress')`
      )
        .bind(surveyId)
        .all<{ user_id: string }>();
      const answeredIds = new Set(memberRows.results.map((m) => m.user_id));

      const tools = this.buildTools({ readOnly: true });

      const system = [
        "You are the agent running a Parlo: a group conversation where members answer by voice. You plan the next ROUND of asks for the owner to approve.",
        "Two kinds of round: a POLL sends the same 1–3 asks to everyone (comparable answers, good for aggregating); a PROBE sends one personal follow-up each to specific members who already answered (depth). Pick whichever moves the creator's goal forward most.",
        "Asks are spoken aloud by the member, so write them warm, conversational, one idea each, under 25 words. Never repeat an ask already on file. A probe must reference something that member actually said.",
        "Respond ONLY with JSON: {\"kind\":\"poll\"|\"probe\",\"rationale\":\"one or two sentences for the owner\",\"asks\":[{\"text\":\"…\",\"hint\":\"short nudge or null\",\"target\":\"all\"|\"<member id>\"}]}. Poll asks use target \"all\"; probe asks use a member id from /members.md who has answered.",
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

      const result = await generateText({
        model: picked.model,
        system,
        prompt,
        tools,
        stopWhen: stepCountIs(10),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });

      const parsed = JSON.parse(extractJson(result.text)) as {
        kind?: string;
        rationale?: string;
        asks?: { text?: string; hint?: string | null; target?: string }[];
      };
      const kind: RoundKind = parsed.kind === "probe" ? "probe" : "poll";
      const asks: ProposedAsk[] = (parsed.asks ?? [])
        .filter((a) => typeof a.text === "string" && a.text.trim())
        .map((a) => {
          const target = a.target && a.target !== "all" ? a.target.trim() : null;
          return {
            text: a.text!.trim().slice(0, 500),
            hint: typeof a.hint === "string" && a.hint.trim() ? a.hint.trim().slice(0, 120) : null,
            type: "voice" as const,
            targetUserId: kind === "probe" && target && answeredIds.has(target) ? target : null,
          };
        })
        .filter((a) => (kind === "probe" ? !!a.targetUserId : true))
        .slice(0, kind === "probe" ? 20 : 3);
      if (asks.length === 0) throw new Error("The agent did not produce any usable asks");

      const created = await createProposedRound(this.env.DB, surveyId, {
        kind,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 600) : null,
        proposedBy: "agent",
        asks,
      });
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

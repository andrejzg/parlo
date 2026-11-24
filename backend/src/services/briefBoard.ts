/**
 * The living brief.
 *
 * A study's brief is not a document that gets signed off and frozen. It is
 * a short list of the questions the study must answer (`brief_items`), each
 * carrying what the answers say so far, and a log of everything that moved
 * it (`brief_events`): a question the client added, a steer from a
 * researcher, the agent marking something answered, a round going out.
 *
 * Two parties work on it together: the research team (owner, admins) and
 * the client. Both add questions, drop them, and steer ("dig into this").
 * The agent reads the answers against the list after every digest
 * (`GroupAgent.readBrief`), suggests questions people keep raising
 * unprompted, and plans the next round from what is still open and from
 * the steers nobody has taken up yet.
 */

import type { Env, GroupMember, GroupRole, Round, Survey, SurveyQuestion } from "../types";
import { generateId } from "./codes";
import { canManage, displayNameFor } from "./groups";
import { runJsonCompletion } from "./ai";
import { generatePresignedReadUrl, generateReadToken } from "./r2";
import { toIso, toMs } from "./home";
import { roundCost, rewardSummary } from "./rewards";

export type BriefStatus = "suggested" | "open" | "emerging" | "answered" | "dropped" | "dismissed";
export type BriefOrigin = "seed" | "researcher" | "client" | "agent";
/** The statuses a question on the board can be in (not a suggestion, not gone). */
export const LIVE_STATUSES: BriefStatus[] = ["open", "emerging", "answered"];

export interface BriefItemRow {
  id: string;
  survey_id: string;
  text: string;
  status: BriefStatus;
  origin: BriefOrigin;
  created_by: string | null;
  sort_order: number;
  finding: string | null;
  why: string | null;
  voices: number;
  evidence: string | null;
  status_by: string;
  created_at: string;
  updated_at: string;
}

export interface BriefEventRow {
  id: string;
  survey_id: string;
  item_id: string | null;
  actor_id: string | null;
  actor_role: string;
  type: string;
  body: string | null;
  round_id: string | null;
  created_at: string;
  /** 'agent' when the change came through the MCP server; null = a person, in the app. */
  via?: string | null;
}

export type BriefEventType =
  | "goal_edited"
  | "item_added"
  | "item_edited"
  | "item_dropped"
  | "item_reopened"
  | "item_answered"
  | "suggestion_made"
  | "suggestion_accepted"
  | "suggestion_dismissed"
  | "status_changed"
  | "steer"
  | "round_proposed"
  | "round_sent";

export const MAX_ITEM_CHARS = 280;
export const MAX_STEER_CHARS = 600;
export const MAX_GOAL_CHARS = 6000;
const MAX_LIVE_ITEMS = 12;

export function originFor(role: GroupRole): BriefOrigin {
  return role === "client" ? "client" : "researcher";
}

// ── Rows ───────────────────────────────────────────────────────────────

export async function listItems(db: D1Database, surveyId: string): Promise<BriefItemRow[]> {
  const r = await db
    .prepare("SELECT * FROM brief_items WHERE survey_id = ? ORDER BY sort_order ASC, created_at ASC")
    .bind(surveyId)
    .all<BriefItemRow>();
  return r.results;
}

export async function getItem(db: D1Database, surveyId: string, itemId: string): Promise<BriefItemRow | null> {
  return db.prepare("SELECT * FROM brief_items WHERE id = ? AND survey_id = ?").bind(itemId, surveyId).first<BriefItemRow>();
}

export async function addItem(
  db: D1Database,
  surveyId: string,
  input: { text: string; origin: BriefOrigin; createdBy: string | null; status?: BriefStatus; why?: string | null; voices?: number }
): Promise<BriefItemRow> {
  const id = generateId();
  const max = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS n FROM brief_items WHERE survey_id = ?").bind(surveyId).first<{ n: number }>();
  await db
    .prepare("INSERT INTO brief_items (id, survey_id, text, status, origin, created_by, sort_order, why, voices) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, surveyId, input.text.trim().slice(0, MAX_ITEM_CHARS), input.status ?? "open", input.origin, input.createdBy, (max?.n ?? 0) + 1, input.why ?? null, input.voices ?? 0)
    .run();
  return (await getItem(db, surveyId, id)) as BriefItemRow;
}

export async function logEvent(
  db: D1Database,
  surveyId: string,
  e: {
    type: BriefEventType;
    actorId?: string | null;
    actorRole: GroupRole | "agent";
    itemId?: string | null;
    body?: string | null;
    roundId?: string | null;
    /** 'agent' when someone's AI agent made the change through the MCP server. */
    via?: string | null;
  }
): Promise<string> {
  const id = generateId();
  await db
    .prepare("INSERT INTO brief_events (id, survey_id, item_id, actor_id, actor_role, type, body, round_id, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, surveyId, e.itemId ?? null, e.actorId ?? null, e.actorRole, e.type, e.body ?? null, e.roundId ?? null, e.via ?? null)
    .run();
  return id;
}

/** Steers nobody has taken up yet: the next round is planned from these. */
export async function openSteers(db: D1Database, surveyId: string): Promise<BriefEventRow[]> {
  const r = await db
    .prepare("SELECT * FROM brief_events WHERE survey_id = ? AND type = 'steer' AND round_id IS NULL ORDER BY created_at ASC")
    .bind(surveyId)
    .all<BriefEventRow>();
  return r.results;
}

/** A round went out: every steer that was open when it did has been taken up by it. */
export async function markSteersTakenUp(db: D1Database, surveyId: string, roundId: string): Promise<number> {
  const r = await db
    .prepare("UPDATE brief_events SET round_id = ? WHERE survey_id = ? AND type = 'steer' AND round_id IS NULL")
    .bind(roundId, surveyId)
    .run();
  return r.meta?.changes ?? 0;
}

// ── Seeding ────────────────────────────────────────────────────────────

/**
 * The first time anyone opens a study's brief, turn the free-text brief into
 * the questions it has to answer. A human edits from there. Runs once: a
 * study whose list was emptied by hand is not re-seeded.
 */
export async function ensureSeeded(env: Env, survey: Survey): Promise<void> {
  const db = env.DB;
  const any = await db.prepare("SELECT 1 FROM brief_items WHERE survey_id = ? LIMIT 1").bind(survey.id).first();
  if (any) return;
  const brief = survey.brief?.trim();
  if (!brief) return;
  const lockKey = `brief-seed:${survey.id}`;
  if (await env.KV.get(lockKey)) return;
  await env.KV.put(lockKey, "1", { expirationTtl: 3600 });

  const asks = await db
    .prepare("SELECT q.text FROM survey_questions q JOIN rounds r ON r.id = q.round_id WHERE q.survey_id = ? AND r.number = 1 ORDER BY q.sort_order ASC LIMIT 12")
    .bind(survey.id)
    .all<{ text: string }>();
  try {
    const questions = await runJsonCompletion(
      env.AI,
      env.CEREBRAS_API_KEY,
      [
        { role: "system", content: "You turn a research brief into the short list of questions the study must be able to answer. Always respond in valid JSON." },
        {
          role: "user",
          content: [
            "BRIEF:",
            brief.slice(0, 6000),
            "",
            asks.results.length ? `What participants are asked in the first round:\n${asks.results.map((a) => `- ${a.text}`).join("\n")}` : "",
            "",
            "List the 3 to 6 questions this study must be able to answer when it is done. These are the researchers' questions (what the team needs to learn), not the wording put to participants. Write each as a full question of 8 to 20 words ending in a question mark, specific to this brief (name the product or the people where the brief does). No overlap, most important first.",
            'Return JSON: {"questions": ["..."]}',
          ].join("\n"),
        },
      ],
      (text) => {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const parsed = JSON.parse(fenced ? fenced[1].trim() : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { questions?: unknown };
        const list = Array.isArray(parsed.questions) ? parsed.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 5) : [];
        if (list.length === 0) throw new Error("no questions in the seed");
        return list.slice(0, 6);
      },
      { maxTokens: 500, properties: { purpose: "brief-seed", surveyId: survey.id } }
    );
    for (const q of questions) await addItem(db, survey.id, { text: q, origin: "seed", createdBy: null });
  } catch (err) {
    console.error("[brief] seeding failed", err);
    // Let the next visit try again.
    await env.KV.delete(lockKey);
  }
}

// ── The agent's reading ────────────────────────────────────────────────

export interface AgentReading {
  items: { id: string; status: "open" | "emerging" | "answered"; finding: string | null; voices: number; evidence: { answerId: string; quote: string }[] }[];
  suggestions: { text: string; why: string | null; voices: number }[];
}

function norm(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Write the agent's reading onto the board. It always refreshes the finding,
 * the voice count and the evidence; it only moves a status a person has not
 * set by hand; it never touches a dropped question.
 */
export async function applyAgentReading(db: D1Database, surveyId: string, reading: AgentReading): Promise<{ moved: number; suggested: number }> {
  const items = await listItems(db, surveyId);
  const byId = new Map(items.map((i) => [i.id, i]));
  let moved = 0;
  for (const r of reading.items) {
    const item = byId.get(r.id);
    if (!item || !LIVE_STATUSES.includes(item.status)) continue;
    const status = item.status_by === "human" ? item.status : r.status;
    await db
      .prepare("UPDATE brief_items SET status = ?, finding = ?, voices = ?, evidence = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(status, r.finding ? r.finding.slice(0, 400) : null, Math.max(0, Math.round(r.voices)), JSON.stringify(r.evidence.slice(0, 3)), item.id)
      .run();
    if (status !== item.status) {
      moved++;
      await logEvent(db, surveyId, { type: "status_changed", actorRole: "agent", itemId: item.id, body: `${item.status} → ${status}` });
    }
  }

  // Suggestions: nothing a person already has, dropped or dismissed; at most three waiting.
  const known = new Set(items.map((i) => norm(i.text)));
  let waiting = items.filter((i) => i.status === "suggested").length;
  let suggested = 0;
  for (const s of reading.suggestions) {
    if (waiting >= 3) break;
    const text = s.text.trim();
    if (text.length < 8 || known.has(norm(text))) continue;
    const row = await addItem(db, surveyId, { text, origin: "agent", createdBy: null, status: "suggested", why: s.why?.slice(0, 300) ?? null, voices: Math.max(0, Math.round(s.voices)) });
    await logEvent(db, surveyId, { type: "suggestion_made", actorRole: "agent", itemId: row.id, body: text });
    known.add(norm(text));
    waiting++;
    suggested++;
  }
  return { moved, suggested };
}

/** The brief as the agent reads it in `/brief.md`: the questions with ids and status, and the open steers. */
export async function briefForAgent(db: D1Database, surveyId: string): Promise<string[]> {
  const items = (await listItems(db, surveyId)).filter((i) => LIVE_STATUSES.includes(i.status));
  if (items.length === 0) return [];
  const steers = await openSteers(db, surveyId);
  const textOf = new Map(items.map((i) => [i.id, i.text]));
  const from = (o: BriefOrigin) => (o === "client" ? "added by the client" : o === "agent" ? "suggested by you, accepted by the team" : o === "seed" ? "from the original brief" : "added by the research team");
  return [
    "## Questions this study must answer (the living brief)",
    "The team keeps this list. Organise the report around it and aim rounds at what is still open.",
    ...items.map((i) => `- [${i.id}] (${i.status}; ${from(i.origin)}) ${i.text}${i.finding ? `\n  So far: ${i.finding} (${i.voices} ${i.voices === 1 ? "voice" : "voices"})` : ""}`),
    "",
    "## Steers from the team that no round has taken up yet",
    steers.length
      ? steers
          .map((s) => `- (${s.actor_role === "client" ? "the client" : "a researcher"}, ${s.created_at.slice(0, 10)})${s.item_id && textOf.get(s.item_id) ? ` on "${textOf.get(s.item_id)}"` : ""}: ${s.body ?? ""}`)
          .join("\n")
      : "(none)",
  ];
}

/** What a testimonial ask tells the participant before they record: who may use the recording. */
export function testimonialNotice(sponsor: string | null | undefined): string {
  const who = sponsor?.trim();
  return who && !/^the company that commissioned/i.test(who)
    ? `${who} may use this recording in its marketing.`
    : "This recording may be used in public marketing material.";
}

/** The stronger of the response's consent and the answer's own (a testimonial is 'voice' by recording it). */
export function effectiveConsent(response: string | null | undefined, answer: string | null | undefined): "none" | "quote" | "voice" {
  const rank = (v: string | null | undefined) => (v === "voice" ? 2 : v === "quote" ? 1 : 0);
  const best = Math.max(rank(response), rank(answer));
  return best === 2 ? "voice" : best === 1 ? "quote" : "none";
}

// ── Who a participant is, to whom ──────────────────────────────────────

export interface ParticipantLabel {
  /** "Customer 3": what the client sees instead of a name. */
  label: string;
  segment: string | null;
  name: string | null;
}

/**
 * A stable label for every participant. The client hears the voice and sees
 * the label, never the name: someone criticising a vendor who can see their
 * name holds back.
 */
export async function participantLabels(db: D1Database, surveyId: string): Promise<Map<string, ParticipantLabel>> {
  const rows = await db
    .prepare(
      `SELECT gm.user_id, gm.segment, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.survey_id = ? AND gm.role = 'member' ORDER BY gm.joined_at ASC, gm.user_id ASC`
    )
    .bind(surveyId)
    .all<{ user_id: string; segment: string | null; first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null }>();
  const counters = new Map<string, number>();
  const out = new Map<string, ParticipantLabel>();
  for (const r of rows.results) {
    const group = r.segment?.trim() || "Participant";
    const n = (counters.get(group) ?? 0) + 1;
    counters.set(group, n);
    out.set(r.user_id, { label: `${group} ${n}`, segment: r.segment?.trim() || null, name: displayNameFor(r) });
  }
  return out;
}

export function whoFor(viewerRole: GroupRole, labels: Map<string, ParticipantLabel>, userId: string | null, fallbackName: string | null): string {
  const known = userId ? labels.get(userId) : undefined;
  if (viewerRole === "client") return known?.label ?? "Participant";
  return known?.name ?? fallbackName ?? known?.label ?? "Anonymous";
}

/**
 * The agent is told not to name participants on a sponsored study, but a
 * prompt is not a guarantee. Before any text the agent wrote reaches the
 * client (the report, a finding, a planned ask), every participant's full
 * name and first name is replaced by their label.
 */
export function nameRedactor(viewerRole: GroupRole, labels: Map<string, ParticipantLabel>): (text: string | null) => string | null {
  if (viewerRole !== "client") return (text) => text;
  const swaps: { pattern: RegExp; label: string }[] = [];
  const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const p of labels.values()) {
    const full = p.name?.trim();
    // A two-letter name ("Al", "Bo") would hit ordinary words; leave it.
    if (!full || full.length < 3) continue;
    const first = full.split(/\s+/)[0];
    // Full names first, so "Dana Whitfield" does not become "Customer 1 Whitfield".
    swaps.unshift({ pattern: new RegExp(`\\b${escape(full)}\\b`, "gi"), label: p.label });
    if (first.length >= 3 && first !== full) swaps.push({ pattern: new RegExp(`\\b${escape(first)}\\b`, "g"), label: p.label });
  }
  if (swaps.length === 0) return (text) => text;
  return (text) => (text ? swaps.reduce((out, s) => out.replace(s.pattern, s.label), text) : text);
}

// ── Answers, as the team hears them ────────────────────────────────────

interface AnswerJoinRow {
  id: string;
  audio_r2_key: string;
  video_r2_key: string | null;
  image_r2_key: string | null;
  transcription: string | null;
  transcription_status: string;
  duration_ms: number;
  response_id: string;
  user_id: string | null;
  r_first: string | null;
  r_last: string | null;
  sponsor_consent: number | null;
  publish_consent: string | null;
  answer_consent: string | null;
  verdict: string | null;
  verdict_note: string | null;
  probes: string | null;
  round_purpose: string | null;
  round_reward_cents: number | null;
  submitted_at: string | null;
  round_number: number | null;
  question_id: string;
  question_text: string;
  question_type: string;
}

const ANSWER_SELECT = `SELECT ra.id, ra.audio_r2_key, ra.video_r2_key, ra.image_r2_key, ra.transcription, ra.transcription_status, ra.duration_ms,
        ra.publish_consent AS answer_consent, ra.verdict, ra.verdict_note, ra.probes,
        r.id AS response_id, r.user_id, r.first_name AS r_first, r.last_name AS r_last, r.sponsor_consent, r.publish_consent, r.submitted_at,
        rd.number AS round_number, rd.purpose AS round_purpose, rd.reward_cents AS round_reward_cents,
        q.id AS question_id, q.text AS question_text, q.question_type
 FROM response_answers ra
 JOIN responses r ON r.id = ra.response_id
 JOIN survey_questions q ON q.id = ra.question_id
 LEFT JOIN rounds rd ON rd.id = q.round_id`;

async function presentAnswer(env: Env, baseUrl: string, viewerRole: GroupRole, labels: Map<string, ParticipantLabel>, a: AnswerJoinRow) {
  const sign = async (key: string | null) => (key ? generatePresignedReadUrl(baseUrl, key, await generateReadToken(env.KV, key)) : null);
  // An imported interview often carries the speaker's name on every line ("Dana: …").
  // The client reads the words under the label, so names come out of the text too.
  // (A recording can still say a name aloud; that cannot be taken out here.)
  const redact = nameRedactor(viewerRole, labels);
  const fallback = [a.r_first, a.r_last].filter(Boolean).join(" ") || null;
  return {
    id: a.id,
    responseId: a.response_id,
    who: whoFor(viewerRole, labels, a.user_id, fallback),
    segment: (a.user_id && labels.get(a.user_id)?.segment) || null,
    roundNumber: a.round_number ?? 1,
    questionId: a.question_id,
    questionText: a.question_text,
    questionType: a.question_type,
    transcription: redact(a.transcription),
    transcriptionStatus: a.transcription_status,
    durationMs: a.duration_ms,
    /** What may leave the study: none | quote (words, unnamed) | voice (the recording too). */
    publishConsent: effectiveConsent(a.publish_consent, a.answer_consent),
    /** How well it answered its question: answered | partial | unanswered; null = not judged. */
    verdict: a.verdict === "answered" || a.verdict === "partial" || a.verdict === "unanswered" ? a.verdict : null,
    verdictNote: a.verdict_note,
    /** The follow-ups the agent asked in the sitting before it let go. */
    probes: parseStrings(a.probes),
    /** 'testimonial' when the ask was for a line meant for public use. */
    purpose: a.round_purpose === "testimonial" ? ("testimonial" as const) : null,
    submittedAt: toIso(a.submitted_at),
    audioUrl: await sign(a.audio_r2_key || null),
    videoUrl: await sign(a.video_r2_key),
    imageUrl: await sign(a.image_r2_key),
  };
}

export type PresentedAnswer = Awaited<ReturnType<typeof presentAnswer>>;

/**
 * Raw answers for the research team and the client. The client only gets
 * responses given under a consent line that named the sponsor, and labels
 * in place of names.
 */
export async function listAnswers(
  env: Env,
  survey: Survey,
  viewer: GroupMember,
  baseUrl: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ answers: PresentedAnswer[]; total: number; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const consent = viewer.role === "client" ? "AND r.sponsor_consent = 1" : "";
  const [rows, totalRow, labels] = await Promise.all([
    env.DB
      .prepare(`${ANSWER_SELECT} WHERE r.survey_id = ? AND r.status != 'in_progress' ${consent} ORDER BY r.submitted_at DESC, q.sort_order ASC LIMIT ? OFFSET ?`)
      .bind(survey.id, limit, offset)
      .all<AnswerJoinRow>(),
    env.DB
      .prepare(`SELECT COUNT(*) AS n FROM response_answers ra JOIN responses r ON r.id = ra.response_id WHERE r.survey_id = ? AND r.status != 'in_progress' ${consent}`)
      .bind(survey.id)
      .first<{ n: number }>(),
    participantLabels(env.DB, survey.id),
  ]);
  const answers = await Promise.all(rows.results.map((a) => presentAnswer(env, baseUrl, viewer.role, labels, a)));
  const total = totalRow?.n ?? 0;
  return { answers, total, hasMore: offset + answers.length < total };
}

// ── The board ──────────────────────────────────────────────────────────

function parseStrings(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseIds(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseEvidence(json: string | null): { answerId: string; quote: string }[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((e) => e && typeof e.answerId === "string" && typeof e.quote === "string") : [];
  } catch {
    return [];
  }
}

/** Everything the brief page shows, shaped for the viewer's seat. */
export async function loadBoard(env: Env, survey: Survey, viewer: GroupMember, baseUrl: string) {
  const db = env.DB;
  const manager = canManage(viewer.role);
  const [items, labels, eventsRes, teamRes, roundsRes, countsRes] = await Promise.all([
    listItems(db, survey.id),
    participantLabels(db, survey.id),
    db.prepare("SELECT * FROM brief_events WHERE survey_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 60").bind(survey.id).all<BriefEventRow>(),
    db
      .prepare(
        `SELECT gm.user_id, gm.role, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone
         FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.survey_id = ? AND gm.removed_at IS NULL AND gm.role IN ('owner', 'admin', 'client')
         ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at ASC`
      )
      .bind(survey.id)
      .all<{ user_id: string; role: GroupRole; first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null }>(),
    db.prepare("SELECT * FROM rounds WHERE survey_id = ? ORDER BY number ASC").bind(survey.id).all<Round>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT COALESCE(r.user_id, r.id)) AS voices, COUNT(ra.id) AS answers
         FROM responses r JOIN response_answers ra ON ra.response_id = r.id
         WHERE r.survey_id = ? AND r.status != 'in_progress'`
      )
      .bind(survey.id)
      .first<{ voices: number; answers: number }>(),
  ]);

  const redact = nameRedactor(viewer.role, labels);
  const team = teamRes.results.map((t) => ({ userId: t.user_id, role: t.role, name: displayNameFor(t) ?? (t.role === "client" ? "Client" : "Researcher") }));
  // Only real names: someone without one reads as "A researcher" or "The client" in a sentence.
  const teamName = new Map(teamRes.results.map((t) => [t.user_id, displayNameFor(t)] as const).filter((e): e is readonly [string, string] => !!e[1]));
  const itemText = new Map(items.map((i) => [i.id, i.text]));
  const roundNumber = new Map(roundsRes.results.map((r) => [r.id, r.number]));

  // Evidence: one query for every quoted answer on the board.
  const evidenceByItem = new Map(items.map((i) => [i.id, parseEvidence(i.evidence)]));
  const answerIds = Array.from(new Set(Array.from(evidenceByItem.values()).flat().map((e) => e.answerId)));
  const presented = new Map<string, PresentedAnswer>();
  if (answerIds.length) {
    const consent = viewer.role === "client" ? "AND r.sponsor_consent = 1" : "";
    const rows = await db
      .prepare(`${ANSWER_SELECT} WHERE ra.id IN (${answerIds.map(() => "?").join(", ")}) AND r.survey_id = ? ${consent}`)
      .bind(...answerIds, survey.id)
      .all<AnswerJoinRow>();
    for (const a of rows.results) presented.set(a.id, await presentAnswer(env, baseUrl, viewer.role, labels, a));
  }

  const present = (i: BriefItemRow) => ({
    id: i.id,
    text: i.text,
    status: i.status,
    origin: i.origin,
    addedBy: i.created_by ? teamName.get(i.created_by) ?? null : null,
    finding: redact(i.finding),
    why: redact(i.why),
    voices: i.voices,
    setByHand: i.status_by === "human",
    createdAt: toIso(i.created_at),
    updatedAt: toIso(i.updated_at),
    evidence: (evidenceByItem.get(i.id) ?? [])
      .map((e) => {
        const a = presented.get(e.answerId);
        return a ? { quote: redact(e.quote) ?? e.quote, answer: a } : null;
      })
      .filter((x): x is { quote: string; answer: PresentedAnswer } => !!x),
  });

  const steers = eventsRes.results.filter((e) => e.type === "steer" && !e.round_id);
  const proposed = [...roundsRes.results].reverse().find((r) => r.status === "proposed") ?? null;
  const live = [...roundsRes.results].reverse().find((r) => r.status === "sent") ?? null;

  const asksOf = async (round: Round) => {
    const res = await db.prepare("SELECT * FROM survey_questions WHERE round_id = ? ORDER BY sort_order ASC").bind(round.id).all<SurveyQuestion>();
    // A round aimed at a segment is one ask per person with the same words; show each wording once.
    const grouped = new Map<string, { id: string; text: string; hint: string | null; type: string; targets: string[] }>();
    for (const q of res.results) {
      const key = `${q.text}\u0000${q.hint ?? ""}`;
      const g = grouped.get(key) ?? { id: q.id, text: redact(q.text) ?? q.text, hint: redact(q.hint), type: q.question_type, targets: [] };
      if (q.target_user_id) g.targets.push(whoFor(viewer.role, labels, q.target_user_id, null));
      grouped.set(key, g);
    }
    return Array.from(grouped.values());
  };

  let nextRound = null;
  if (proposed) {
    const cost = await roundCost(db, survey, proposed);
    nextRound = {
      id: proposed.id,
      number: proposed.number,
      kind: proposed.kind,
      purpose: proposed.purpose === "testimonial" ? ("testimonial" as const) : null,
      rationale: redact(proposed.rationale),
      createdAt: toIso(proposed.created_at),
      serves: parseIds(proposed.serves).filter((id) => itemText.has(id)),
      asks: await asksOf(proposed),
      cost,
    };
  }

  let liveRound = null;
  if (live) {
    const answered = await db
      .prepare(
        `SELECT COUNT(DISTINCT resp.user_id) AS n FROM response_answers ra
         JOIN responses resp ON resp.id = ra.response_id
         JOIN survey_questions q ON q.id = ra.question_id
         WHERE q.round_id = ? AND resp.status != 'in_progress' AND resp.user_id IS NOT NULL`
      )
      .bind(live.id)
      .first<{ n: number }>();
    liveRound = {
      id: live.id,
      number: live.number,
      kind: live.kind,
      purpose: live.purpose === "testimonial" ? ("testimonial" as const) : null,
      sentAt: toIso(live.sent_at),
      closesAt: live.closes_at ?? null,
      serves: parseIds(live.serves).filter((id) => itemText.has(id)),
      asks: await asksOf(live),
      answered: answered?.n ?? 0,
      rewardCents: live.reward_cents ?? 0,
    };
  }

  // A steer newer than the plan on the table means the agent is still working it in.
  const planAt = toMs(proposed?.created_at) ?? 0;
  const planning = steers.some((s) => (toMs(s.created_at) ?? 0) > planAt);

  const actor = (e: BriefEventRow) =>
    e.actor_role === "agent" ? "The agent" : (e.actor_id && teamName.get(e.actor_id)) || (e.actor_role === "client" ? "The client" : "A researcher");

  return {
    survey: {
      id: survey.id,
      code: survey.code,
      title: survey.title,
      sponsor: survey.sponsor_name ?? null,
      study: survey.kind === "study" || !!survey.sponsor_name,
      testimonialNotice: testimonialNotice(survey.sponsor_name),
      // The dashboard code opens names and phone numbers; the client never gets it.
      dashboardCode: manager ? survey.dashboard_code : null,
    },
    you: { userId: viewer.user_id, role: viewer.role, canManage: manager },
    goal: survey.brief ?? "",
    items: items.filter((i) => LIVE_STATUSES.includes(i.status)).map(present),
    suggestions: items.filter((i) => i.status === "suggested").map(present),
    dropped: items.filter((i) => i.status === "dropped").map(present),
    steers: steers
      .map((s) => ({ id: s.id, itemId: s.item_id, itemText: s.item_id ? itemText.get(s.item_id) ?? null : null, body: s.body ?? "", by: actor(s), role: s.actor_role, at: toIso(s.created_at) }))
      .reverse(),
    planning,
    nextRound,
    liveRound,
    timeline: eventsRes.results.slice(0, 40).map((e) => ({
      id: e.id,
      type: e.type,
      // The agent's own lines (a plan's rationale, a suggestion) can carry a name; a person's steer is theirs.
      body: e.actor_role === "agent" ? redact(e.body) : e.body,
      itemId: e.item_id,
      itemText: e.item_id ? itemText.get(e.item_id) ?? null : null,
      by: actor(e),
      role: e.actor_role,
      // Someone's AI agent made this change for them, through the MCP server.
      viaAgent: e.via === "agent",
      roundNumber: e.round_id ? roundNumber.get(e.round_id) ?? null : null,
      at: toIso(e.created_at),
    })),
    report: { markdown: redact(survey.report_md ?? null), updatedAt: survey.report_updated_at ?? null },
    voices: countsRes?.voices ?? 0,
    answers: countsRes?.answers ?? 0,
    /** People brought into the study as participants, whether or not they have answered. */
    participants: labels.size,
    team,
    rewards: await rewardSummary(env, survey),
  };
}

export type BriefBoard = Awaited<ReturnType<typeof loadBoard>>;

/**
 * What may be used in public: every answer whose speaker said yes, to their
 * words ('quote') or to the recording ('voice'). For the research team, with
 * names: they are the ones who clear a clip before it goes anywhere. Each
 * clip says whether it was recorded for a bonus, because a paid line is an
 * incentivised endorsement and whoever publishes it has to be able to say so.
 */
export async function listClips(env: Env, survey: Survey, baseUrl: string) {
  const [rows, labels] = await Promise.all([
    env.DB
      .prepare(
        `${ANSWER_SELECT}
         WHERE r.survey_id = ? AND r.status != 'in_progress' AND ra.transcription_status = 'completed'
           AND (ra.publish_consent IN ('quote', 'voice') OR r.publish_consent IN ('quote', 'voice'))
         ORDER BY (rd.purpose = 'testimonial') DESC, r.submitted_at DESC LIMIT 200`
      )
      .bind(survey.id)
      .all<AnswerJoinRow>(),
    participantLabels(env.DB, survey.id),
  ]);
  const notice = testimonialNotice(survey.sponsor_name);
  return Promise.all(
    rows.results.map(async (a) => {
      const answer = await presentAnswer(env, baseUrl, "owner", labels, a);
      const testimonial = a.round_purpose === "testimonial";
      const bonusCents = testimonial ? a.round_reward_cents ?? 0 : 0;
      return {
        ...answer,
        testimonial,
        /** Paid extra to record this line: disclose it wherever the clip is published. */
        incentivised: testimonial && bonusCents > 0,
        bonusCents,
        /** What the participant was told on the ask before recording; null for an ordinary answer covered by their consent choice. */
        notice: testimonial ? notice : null,
        /** The recording may be used only with 'voice'; with 'quote' the words may be, unnamed. */
        audioUsable: answer.publishConsent === "voice" && !!answer.audioUrl,
      };
    })
  );
}

/**
 * What changed on the brief since a moment, oldest first: for an agent that
 * comes back to a study and wants only what is new.
 */
export async function eventsSince(db: D1Database, survey: Survey, viewer: GroupMember, sinceIso: string | null, limit = 100) {
  // `created_at` is SQLite's "YYYY-MM-DD HH:MM:SS" in UTC (pitfall 25).
  const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
  const since = Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString().slice(0, 19).replace("T", " ") : "1970-01-01 00:00:00";
  const [events, team, items, rounds, labels] = await Promise.all([
    db
      .prepare("SELECT * FROM brief_events WHERE survey_id = ? AND created_at > ? ORDER BY created_at ASC, rowid ASC LIMIT ?")
      .bind(survey.id, since, Math.min(Math.max(limit, 1), 200))
      .all<BriefEventRow>(),
    db
      .prepare(
        `SELECT gm.user_id, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone
         FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.survey_id = ? AND gm.role IN ('owner', 'admin', 'client')`
      )
      .bind(survey.id)
      .all<{ user_id: string; first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null }>(),
    listItems(db, survey.id),
    db.prepare("SELECT id, number FROM rounds WHERE survey_id = ?").bind(survey.id).all<{ id: string; number: number }>(),
    participantLabels(db, survey.id),
  ]);
  const redact = nameRedactor(viewer.role, labels);
  const names = new Map(team.results.map((t) => [t.user_id, displayNameFor(t)] as const));
  const itemText = new Map(items.map((i) => [i.id, i.text]));
  const roundNumber = new Map(rounds.results.map((r) => [r.id, r.number]));
  return events.results.map((e) => ({
    id: e.id,
    type: e.type,
    body: e.actor_role === "agent" ? redact(e.body) : e.body,
    itemId: e.item_id,
    itemText: e.item_id ? itemText.get(e.item_id) ?? null : null,
    by: e.actor_role === "agent" ? "The agent" : (e.actor_id && names.get(e.actor_id)) || (e.actor_role === "client" ? "The client" : "A researcher"),
    role: e.actor_role,
    viaAgent: e.via === "agent",
    roundNumber: e.round_id ? roundNumber.get(e.round_id) ?? null : null,
    at: toIso(e.created_at),
  }));
}
export { MAX_LIVE_ITEMS };

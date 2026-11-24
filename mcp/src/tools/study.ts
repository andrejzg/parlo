import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ParloApiError, type ParloClient } from "../client.js";

/**
 * Study tools: how an AI agent works on a research study, for the research
 * team and for the client alike.
 *
 * One set of tools for both seats. The backend decides what a seat may do
 * (a client reads, shapes the brief and steers; only the research team
 * plans, prices and sends rounds, brings people in and handles rewards), so
 * a refused call comes back with the reason in a sentence and nothing here
 * needs to know who is calling.
 *
 * Every reply is text an agent can act on: ids inline for the next call,
 * the caller's seat stated, and what it can do next. No signed media URLs:
 * an agent reads transcripts, it does not listen.
 */

// ── Shapes (the backend's, trimmed to what the tools read) ──────────────

interface Answer {
  id: string;
  who: string;
  segment: string | null;
  roundNumber: number;
  questionText: string;
  transcription: string | null;
  transcriptionStatus: string;
  publishConsent: "none" | "quote" | "voice";
  verdict?: "answered" | "partial" | "unanswered" | null;
  probes?: string[];
  purpose?: "testimonial" | null;
  submittedAt: string | null;
}
interface Clip extends Answer {
  testimonial: boolean;
  incentivised: boolean;
  bonusCents: number;
  notice: string | null;
  audioUsable: boolean;
  audioUrl: string | null;
}
interface Item {
  id: string;
  text: string;
  status: string;
  origin: string;
  addedBy: string | null;
  finding: string | null;
  why: string | null;
  voices: number;
  setByHand: boolean;
  evidence: { quote: string; answer: Answer }[];
}
interface Ask {
  id: string;
  text: string;
  hint: string | null;
  targets: string[];
}
interface Cost {
  rewardCents: number;
  reach: number;
  maxCents: number;
  budgetCents: number | null;
  committedCents: number;
  remainingCents: number | null;
  fits: boolean;
}
interface StudyEvent {
  id: string;
  type: string;
  body: string | null;
  itemText: string | null;
  by: string;
  role: string;
  viaAgent?: boolean;
  roundNumber: number | null;
  at: string | null;
}
interface Rewards {
  currency: string;
  defaultCents: number | null;
  budgetCents: number | null;
  committedCents: number;
  remainingCents: number | null;
  sentCents: number;
  owedCents: number;
  heldCount: number;
  failedCount: number;
  payouts: "sandbox" | "production" | null;
}
interface Board {
  survey: { id: string; code: string; title: string | null; sponsor: string | null; study: boolean; testimonialNotice?: string; dashboardCode: string | null };
  you: { userId: string; role: string; canManage: boolean };
  goal: string;
  items: Item[];
  suggestions: Item[];
  dropped: Item[];
  steers: { id: string; itemId: string | null; itemText: string | null; body: string; by: string; role: string; at: string | null }[];
  planning: boolean;
  nextRound: { id: string; number: number; kind: string; purpose?: string | null; rationale: string | null; serves: string[]; asks: Ask[]; cost: Cost } | null;
  liveRound: { id: string; number: number; kind: string; purpose?: string | null; sentAt: string | null; closesAt: string | null; serves: string[]; asks: Ask[]; answered: number; rewardCents: number } | null;
  timeline: StudyEvent[];
  report: { markdown: string | null; updatedAt: string | null };
  voices: number;
  answers: number;
  team: { userId: string; role: string; name: string }[];
  rewards: Rewards;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/** A refused or failed call, as a sentence the agent can act on. */
function explain(err: unknown): string {
  if (err instanceof ParloApiError) {
    let reason = err.body;
    try {
      const parsed = JSON.parse(err.body) as { error?: string };
      if (parsed?.error) reason = parsed.error;
    } catch {
      /* not JSON */
    }
    if (err.status === 401) return `Not signed in to Parlo (${reason}). Connect with your person's API key, or use join_study with an invite link to get a seat.`;
    if (err.status === 403 && /not a member/i.test(reason)) return "You have no seat on this study. If your person was sent an invite link (https://parlo.me/join/…), take the seat with join_study; otherwise ask the research team for one.";
    if (err.status === 403) return `Refused: ${reason}. This depends on your seat: the research team (owner, admin) sends rounds, brings people in and handles rewards; the client reads, shapes the brief and steers. Call get_study to see your seat.`;
    if (err.status === 404) return `Not found: ${reason}. Check the id with list_studies or get_study.`;
    if (err.status === 409) return `Not possible right now: ${reason}`;
    if (err.status === 429) return `Rate limited: ${reason}`;
    return `Parlo answered ${err.status}: ${reason}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function run(fn: () => Promise<string>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(explain(err));
  }
}

function money(cents: number, currency = "USD"): string {
  const amount = cents / 100;
  const digits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** Major units from an agent (10 = $10) to cents; null clears. */
function toCents(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return Math.round(value * 100);
}

function seatLine(role: string): string {
  if (role === "client") return "the client: you can read everything, add, reword and drop the study's questions, answer the agent's suggestions, and steer. You cannot send rounds, bring people in or handle rewards.";
  if (role === "owner" || role === "admin") return `the research team (${role}): you can do everything, including planning, pricing and sending rounds, adding participants, inviting the client and handling rewards.`;
  return `a ${role}.`;
}

function people(n: number) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function costLine(cost: Cost, currency: string): string {
  if (!cost.rewardCents) return "unpaid";
  const left = cost.remainingCents === null ? "no budget set" : `${money(Math.max(0, cost.remainingCents), currency)} of ${money(cost.budgetCents ?? 0, currency)} left`;
  return `${money(cost.rewardCents, currency)} per answer; up to ${people(cost.reach)} × ${money(cost.rewardCents, currency)} = ${money(cost.maxCents, currency)}; ${left}${cost.fits ? "" : " (DOES NOT FIT the budget: lower the reward or raise the budget before sending)"}`;
}

function asksLines(asks: Ask[]): string[] {
  return asks.map((a) => `  - [ask ${a.id}] ${a.text}${a.hint ? ` (hint: ${a.hint})` : ""} → ${a.targets.length === 0 ? "everyone" : a.targets.length <= 4 ? a.targets.join(", ") : people(a.targets.length)}`);
}

function eventLine(e: StudyEvent): string {
  const who = `${e.by}${e.viaAgent ? "'s agent" : ""}${e.role === "client" ? " (client)" : ""}`;
  const q = e.itemText ? `"${e.itemText}"` : "a question";
  const what =
    e.type === "steer"
      ? `steered${e.itemText ? ` on ${q}` : ""}: ${e.body ?? ""}${e.roundNumber ? ` [taken up in round ${e.roundNumber}]` : " [not yet taken up]"}`
      : e.type === "item_added"
      ? `added ${q}`
      : e.type === "item_edited"
      ? `reworded a question to ${q}`
      : e.type === "item_dropped"
      ? `dropped ${q}`
      : e.type === "item_reopened"
      ? `reopened ${q}`
      : e.type === "item_answered"
      ? `marked ${q} answered`
      : e.type === "status_changed"
      ? `moved ${q}: ${e.body ?? ""}`
      : e.type === "suggestion_made"
      ? `suggested adding "${e.body ?? ""}"`
      : e.type === "suggestion_accepted"
      ? `accepted the agent's suggestion ${q}`
      : e.type === "suggestion_dismissed"
      ? `dismissed the agent's suggestion ${q}`
      : e.type === "goal_edited"
      ? "rewrote what the study is for"
      : e.type === "round_proposed"
      ? `planned round ${e.roundNumber ?? ""}${e.body ? `: ${e.body}` : ""}`
      : e.type === "round_sent"
      ? `sent round ${e.roundNumber ?? ""}`
      : `${e.type}${e.body ? `: ${e.body}` : ""}`;
  return `- ${e.at ?? ""} · ${who} ${what}`;
}

/** The whole study as one readable page. */
function renderBoard(b: Board): string {
  const currency = b.rewards.currency;
  const answered = b.items.filter((i) => i.status === "answered").length;
  const lines: string[] = [
    `# ${b.survey.title ?? "Untitled study"}`,
    `study_id: ${b.survey.id}${b.survey.sponsor ? ` · commissioned by ${b.survey.sponsor}` : ""} · ${b.voices} ${b.voices === 1 ? "voice" : "voices"}, ${b.answers} ${b.answers === 1 ? "answer" : "answers"}`,
    `Your seat: ${seatLine(b.you.role)}`,
    `Team: ${b.team.map((t) => `${t.name} (${t.role === "client" ? "client" : "research team"})`).join(", ") || "(nobody named yet)"}`,
    "",
    "## What the study is for",
    b.goal || "(not written yet; set it with set_study_goal)",
    "",
    `## The questions the study must answer (${answered} of ${b.items.length} answered)`,
  ];
  if (b.items.length === 0) lines.push("(none yet; add one with add_study_question)");
  for (const item of b.items) {
    const flags = [
      item.status.toUpperCase(),
      `${item.voices} ${item.voices === 1 ? "voice" : "voices"}`,
      item.origin === "client" ? "added by the client" : item.origin === "agent" ? "suggested by the study's agent" : item.origin === "seed" ? "from the original brief" : "added by the research team",
      item.setByHand ? "status set by a person" : null,
      b.liveRound?.serves.includes(item.id) ? `being asked now in round ${b.liveRound.number}` : null,
      b.nextRound?.serves.includes(item.id) ? `in the plan for round ${b.nextRound.number}` : null,
    ].filter(Boolean);
    lines.push(`- [question ${item.id}] ${item.text}`, `    ${flags.join(" · ")}`);
    lines.push(`    So far: ${item.finding ?? "no answer yet"}`);
    for (const e of item.evidence) lines.push(`    "${e.quote}" — ${e.answer.who}, round ${e.answer.roundNumber} [may be published: ${e.answer.publishConsent}]`);
    for (const s of b.steers.filter((x) => x.itemId === item.id)) lines.push(`    ↳ open steer from ${s.by}${s.role === "client" ? " (client)" : ""}: ${s.body}`);
  }

  if (b.suggestions.length) {
    lines.push("", "## The study's agent suggests adding (answer with review_agent_suggestion)");
    for (const s of b.suggestions) lines.push(`- [question ${s.id}] ${s.text} — ${people(s.voices)} raised it unprompted${s.why ? `. ${s.why}` : ""}`);
  }

  const general = b.steers.filter((s) => !s.itemId);
  if (general.length) {
    lines.push("", "## Open steers on the study as a whole");
    for (const s of general) lines.push(`- ${s.by}${s.role === "client" ? " (client)" : ""}: ${s.body}`);
  }

  lines.push("", "## The next round");
  if (b.planning) lines.push("The study's agent is re-planning from a recent steer; call get_study again in about half a minute.");
  if (b.nextRound) {
    const r = b.nextRound;
    lines.push(
      `Planned, not sent: round ${r.number} (${
        r.purpose === "testimonial" ? "TESTIMONIALS: a line for public use from each person named, for a bonus" : r.kind === "probe" ? "follow-ups aimed at the people named" : "the same asks for everyone"
      }) · round_id: ${r.id}`,
      r.purpose === "testimonial" ? `Each person is told on the ask: "${b.survey.testimonialNotice ?? "This recording may be used in public marketing material."}" Recording it is their consent; they may decline.` : "",
      r.rationale ? `Why: ${r.rationale}` : "",
      ...asksLines(r.asks),
      `Cost: ${costLine(r.cost, currency)}`,
      b.you.canManage ? "You can edit_round, send_round or dismiss_round, or plan_next_round to have it planned again." : "Only the research team sends rounds. Steer to change this plan."
    );
  } else if (!b.planning) {
    lines.push(b.you.canManage ? "Nothing planned. plan_next_round asks the study's agent for one; any steer or change to the questions triggers a plan too." : "Nothing planned. A steer or a new question makes the study's agent plan one.");
  }

  if (b.liveRound) {
    const r = b.liveRound;
    lines.push(
      "",
      "## Out now",
      `Round ${r.number} (${r.purpose === "testimonial" ? "testimonials" : r.kind}) · ${people(r.answered)} answered${r.rewardCents ? ` · ${money(r.rewardCents, currency)} per answer` : ""}${r.closesAt ? ` · closes ${r.closesAt}` : ""} · sent ${r.sentAt ?? ""}`,
      ...asksLines(r.asks)
    );
  }

  const rw = b.rewards;
  if (rw.budgetCents !== null || rw.committedCents > 0 || rw.defaultCents) {
    lines.push(
      "",
      "## Rewards",
      `${money(rw.committedCents, currency)} promised${rw.budgetCents !== null ? ` of a ${money(rw.budgetCents, currency)} budget` : " (no budget set)"}; default ${rw.defaultCents ? money(rw.defaultCents, currency) : "none"} per answer; ${
        rw.payouts === null ? "payouts are not connected, so rewards are recorded and wait as owed" : rw.payouts === "sandbox" ? "sandbox payouts (no real money)" : "live payouts"
      }${rw.heldCount ? `; ${rw.heldCount} held for a look` : ""}${rw.failedCount ? `; ${rw.failedCount} failed` : ""}.`
    );
  }

  if (b.timeline.length) {
    lines.push("", "## Recent changes (newest first; get_study_changes gives everything since a time)");
    for (const e of b.timeline.slice(0, 8)) lines.push(eventLine(e));
  }
  lines.push("", `Report: ${b.report.markdown ? `updated ${b.report.updatedAt ?? ""}; read it with get_study_report` : "not written yet (the study's agent writes it a few minutes after the first answers)"}.`);
  lines.push(`Open in a browser: https://parlo.me/study/${b.survey.id}`);
  return lines.filter((l) => l !== "").join("\n").replace(/\n(## )/g, "\n\n$1");
}

const studyId = z.string().min(8).describe("The study's id, from list_studies or create_study.");
const readOnly = { readOnlyHint: true, openWorldHint: false };
const edits = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function registerStudyTools(server: McpServer, client: ParloClient) {
  const base = (id: string) => `/api/my/surveys/${encodeURIComponent(id)}`;

  // ── Read ──────────────────────────────────────────────────────────────

  server.tool(
    "list_studies",
    "List the research studies you have a seat on, with your seat on each (research team or client), who commissioned it, and what is waiting. Start here.",
    {},
    readOnly,
    async () =>
      run(async () => {
        const res = await client.api<{ surveys: Array<Record<string, any>> }>("GET", "/api/my/surveys");
        const all = res.surveys ?? [];
        const studies = all.filter((s) => s.study && s.role !== "member");
        if (studies.length === 0) {
          return `You have no seat on any study yet (${all.length} other parlo${all.length === 1 ? "" : "s"} on this account). To join one, call join_study with the invite link you were given. To start one, call create_study with the brief.`;
        }
        return [
          `${studies.length} ${studies.length === 1 ? "study" : "studies"}:`,
          ...studies.map(
            (s) =>
              `- [study ${s.id}] ${s.title ?? "Untitled study"} · your seat: ${s.role === "client" ? "client" : `research team (${s.role})`}${s.sponsor ? ` · for ${s.sponsor}` : ""} · ${s.responseCount} responses` +
              `${s.round ? ` · round ${s.round.number} out` : ""}${s.proposedRound ? ` · round ${s.proposedRound.number} planned, not sent` : ""} · last activity ${s.lastActivityAt ?? "unknown"}`
          ),
          "",
          "Next: get_study with a study_id.",
        ].join("\n");
      })
  );

  server.tool(
    "get_study",
    "Read a study as it stands: what it is for, the questions it must answer with each one's status (open, emerging, answered), the finding so far and the quotes behind it, open steers, the round planned next and what it would cost, the round that is out, rewards, and recent changes. Read this before changing anything.",
    { study_id: studyId },
    readOnly,
    async ({ study_id }) => run(async () => renderBoard(await client.api<Board>("GET", `${base(study_id)}/brief`)))
  );

  server.tool(
    "get_study_answers",
    "Read what participants actually said: transcripts, newest first, with who said it (a label like \"Customer 3\" if you are the client), their segment, the round, and whether the words may be published. Use it to check a finding or to find a quote.",
    {
      study_id: studyId,
      limit: z.number().int().min(1).max(50).optional().describe("How many answers (default 20)."),
      offset: z.number().int().min(0).optional().describe("Skip this many, for the next page."),
      segment: z.string().optional().describe("Only this segment, e.g. \"Customer\". Filters within the page fetched."),
      round: z.number().int().min(0).optional().describe("Only this round. Round 0 is imported interviews."),
    },
    readOnly,
    async ({ study_id, limit, offset, segment, round }) =>
      run(async () => {
        const want = limit ?? 20;
        const filtered = segment !== undefined || round !== undefined;
        const res = await client.api<{ answers: Answer[]; total: number; hasMore: boolean }>("GET", `${base(study_id)}/answers?limit=${filtered ? 100 : want}&offset=${offset ?? 0}`);
        let answers = res.answers;
        if (segment) answers = answers.filter((a) => (a.segment ?? "").toLowerCase() === segment.toLowerCase());
        if (round !== undefined) answers = answers.filter((a) => a.roundNumber === round);
        answers = answers.slice(0, want);
        if (answers.length === 0) return `No answers${filtered ? " match that filter in this page" : " yet"} (${res.total} in the study that you may read).`;
        return [
          `${answers.length} of ${res.total} answers${res.hasMore ? ` (more with offset ${(offset ?? 0) + res.answers.length})` : ""}:`,
          ...answers.map(
            (a) =>
              `\n[answer ${a.id}] ${a.who}${a.segment ? ` (${a.segment})` : ""} · ${a.roundNumber === 0 ? "imported interview" : `round ${a.roundNumber}`}${a.purpose === "testimonial" ? " · testimonial" : ""} · ${a.submittedAt ?? ""} · may be published: ${a.publishConsent}${
                a.verdict ? ` · ${a.verdict === "answered" ? "answered the question" : a.verdict === "partial" ? "PARTLY answered the question" : "DID NOT answer the question"}` : ""
              }\nAsked: ${a.questionText}${(a.probes ?? []).map((p) => `\nThe agent followed up: ${p}`).join("")}\nSaid: ${
                a.transcription?.trim() || (a.transcriptionStatus === "pending" ? "(still being transcribed)" : "(no speech transcribed)")
              }`
          ),
          "",
          "\"may be published\" — none: stays inside the study. quote: the words may be quoted in public material, without the name. voice: the recording may be used too.",
        ].join("\n");
      })
  );

  server.tool(
    "get_study_report",
    "Read the report the study's agent keeps: a summary, one section per question, and what is not yet known. It is rewritten as answers come in.",
    { study_id: studyId },
    readOnly,
    async ({ study_id }) =>
      run(async () => {
        const b = await client.api<Board>("GET", `${base(study_id)}/brief`);
        if (!b.report.markdown) return "No report yet. The study's agent writes it a few minutes after the first answers come in.";
        return `Report for "${b.survey.title ?? "Untitled study"}", updated ${b.report.updatedAt ?? "unknown"}:\n\n${b.report.markdown}`;
      })
  );

  server.tool(
    "get_study_changes",
    "What changed on a study since a moment: questions added, reworded or dropped, steers, the agent's status changes, rounds planned and sent, each with who did it. Pass the `now` value from your last call as `since` to get only the news.",
    {
      study_id: studyId,
      since: z.string().optional().describe("ISO timestamp. Left out, the whole log (up to 100 entries)."),
    },
    readOnly,
    async ({ study_id, since }) =>
      run(async () => {
        const res = await client.api<{ events: StudyEvent[]; now: string }>("GET", `${base(study_id)}/brief/events?limit=100${since ? `&since=${encodeURIComponent(since)}` : ""}`);
        if (res.events.length === 0) return `Nothing changed${since ? ` since ${since}` : ""}. now: ${res.now}`;
        return [`${res.events.length} change${res.events.length === 1 ? "" : "s"}${since ? ` since ${since}` : ""}, oldest first:`, ...res.events.map(eventLine), "", `now: ${res.now} (pass this as \`since\` next time)`].join("\n");
      })
  );

  // ── Shape the brief (both seats) ──────────────────────────────────────

  server.tool(
    "add_study_question",
    "Add a question the study must be able to answer (a researcher's question, not the wording put to participants). The study's agent reads the existing answers against it and plans the next round around it within about half a minute.",
    { study_id: studyId, question: z.string().min(8).max(280).describe("One question, 8 to 280 characters.") },
    edits,
    async ({ study_id, question }) =>
      run(async () => {
        const b = await client.api<Board>("POST", `${base(study_id)}/brief/items`, { text: question });
        const added = b.items.find((i) => i.text === question.trim().replace(/\s+/g, " ")) ?? b.items[b.items.length - 1];
        return `Added [question ${added?.id}] "${added?.text}". The study now has ${b.items.length} questions. The study's agent is reading the answers against it and re-planning; call get_study in about half a minute to see its status and the new plan.`;
      })
  );

  server.tool(
    "update_study_question",
    "Reword a question on the brief, or set where it stands: `answered` (the team has its answer; the agent then leaves the status alone), `open` (reopen it and hand the status back to the agent), or `dropped` (take it off the brief; it can be reopened later).",
    {
      study_id: studyId,
      question_id: z.string().min(8).describe("From get_study: the id after \"question\"."),
      text: z.string().min(8).max(280).optional().describe("New wording."),
      status: z.enum(["open", "answered", "dropped"]).optional(),
    },
    edits,
    async ({ study_id, question_id, text, status }) =>
      run(async () => {
        if (text === undefined && status === undefined) return "Nothing to change: pass `text`, `status`, or both.";
        const b = await client.api<Board>("PUT", `${base(study_id)}/brief/items/${encodeURIComponent(question_id)}`, { text, status });
        const item = [...b.items, ...b.dropped].find((i) => i.id === question_id);
        return `Done. [question ${question_id}] is now ${item ? `${item.status}: "${item.text}"` : status ?? "updated"}. The other side has been told, and the study's agent re-plans from the change.`;
      })
  );

  server.tool(
    "review_agent_suggestion",
    "Answer a question the study's agent suggested adding (listed under suggestions in get_study): accept puts it on the brief, dismiss sets it aside.",
    { study_id: studyId, question_id: z.string().min(8), verdict: z.enum(["accept", "dismiss"]) },
    edits,
    async ({ study_id, question_id, verdict }) =>
      run(async () => {
        const b = await client.api<Board>("POST", `${base(study_id)}/brief/items/${encodeURIComponent(question_id)}/${verdict}`);
        return verdict === "accept" ? `Accepted. It is on the brief now (${b.items.length} questions) and the study's agent plans around it.` : "Dismissed. It will not be suggested again.";
      })
  );

  server.tool(
    "steer_study",
    "Tell the study's agent what to dig into next, in a sentence or two: who to ask, what to probe, a hunch to test. Attach it to a question with `question_id`, or leave that out to steer the study as a whole. The agent works every open steer into the next round's plan within about half a minute; the other side sees the steer and who made it.",
    {
      study_id: studyId,
      note: z.string().min(4).max(600).describe("The steer, as you would say it to a research colleague."),
      question_id: z.string().min(8).optional().describe("The question this is about, from get_study."),
    },
    edits,
    async ({ study_id, note, question_id }) =>
      run(async () => {
        const b = await client.api<Board>("POST", `${base(study_id)}/brief/steer`, { note, itemId: question_id ?? null });
        return `Steer recorded (${b.steers.length} open). The study's agent is working it into the plan for the next round; call get_study in about half a minute to read the new plan. ${
          b.you.canManage ? "When the plan is right, send_round sends it." : "The research team decides when the round goes out."
        }`;
      })
  );

  server.tool(
    "set_study_goal",
    "Rewrite the paragraph that says what the study is for. Use this when the purpose itself has moved; for a single line of inquiry use add_study_question or steer_study instead.",
    { study_id: studyId, goal: z.string().min(10).max(6000) },
    edits,
    async ({ study_id, goal }) =>
      run(async () => {
        await client.api<Board>("PUT", `${base(study_id)}/brief/goal`, { goal });
        return "The study's purpose is updated. The other side has been told, and the study's agent re-plans from it.";
      })
  );

  // ── Seats ─────────────────────────────────────────────────────────────

  server.tool(
    "join_study",
    "Take a seat on a study from an invite link (https://parlo.me/join/…) that the research team sent your person: the client seat, or a seat on the research team, whichever the link carries. After this the study shows in list_studies.",
    {
      invite: z.string().min(16).describe("The invite link, or just its token."),
      name: z.string().max(60).optional().describe("How you should appear in the study's log, e.g. \"Maria Chen\". Only used if this account has no name yet."),
    },
    edits,
    async ({ invite, name }) =>
      run(async () => {
        const token = invite.trim().split(/[/?#]/).filter(Boolean).pop() ?? "";
        if (!/^[a-z0-9]{16,64}$/.test(token)) return "That does not look like an invite link. It should end in /join/<token>.";
        const [first, ...rest] = (name ?? "").trim().split(/\s+/).filter(Boolean);
        const res = await client.api<{ surveyId: string; role: string }>("POST", `/api/join/${token}`, { firstName: first, lastName: rest.join(" ") || undefined });
        return `You hold a seat on study ${res.surveyId} as ${seatLine(res.role)}\nNext: get_study with study_id ${res.surveyId}.`;
      })
  );

  // ── Research team: start, plan, send ──────────────────────────────────

  server.tool(
    "create_study",
    "Start a research study from a brief, in one call. The study's agent writes the first round from the brief (or uses your own questions), and the brief's questions are listed the first time the study is read. You own it. Afterwards: add_participants for the people to hear from, create_invite for the client.",
    {
      brief: z.string().min(20).max(20000).describe("What the study is for, who it should hear from, what the team needs to learn. Paste the interview guide too if there is one."),
      title: z.string().max(120).optional().describe("Left out, it is named from the brief."),
      sponsor: z.string().max(80).optional().describe("Who commissioned it. Participants are told this name hears their answers. Leave out for an internal study."),
      reward_per_answer: z.number().min(0).max(500).optional().describe("Default reward per accepted answer, in major units (10 = $10)."),
      budget: z.number().min(0).max(1_000_000).optional().describe("Cap on rewards for the whole study, in major units."),
      currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD"]).optional(),
      questions: z.array(z.string().min(8).max(500)).max(12).optional().describe("Your own round-1 questions, as put to participants. Left out, they are written from the brief."),
    },
    edits,
    async ({ brief, title, sponsor, reward_per_answer, budget, currency, questions }) =>
      run(async () => {
        const res = await client.api<{ surveyId: string; title: string; sponsor: string | null; questions: { text: string }[]; studyLink: string; shareLink: string }>("POST", "/api/studies", {
          brief,
          title,
          sponsorName: sponsor,
          rewardCents: toCents(reward_per_answer),
          budgetCents: toCents(budget),
          currency,
          questions,
        });
        return [
          `Study "${res.title}" is ready. study_id: ${res.surveyId}${res.sponsor ? ` · commissioned by ${res.sponsor}` : ""}`,
          `Round 1 (${res.questions.length} questions):`,
          ...res.questions.map((q) => `  - ${q.text}`),
          `Open it: ${res.studyLink}`,
          "",
          "Next:",
          "1. get_study lists the questions the study must answer (seeded from the brief on first read).",
          "2. add_participants brings in the people to hear from; each gets a personal link, and only answers through a personal link are paid.",
          "3. create_invite with role \"client\" gives you a link for the client. Invite them before collecting answers: the client only hears answers given after the consent screen names them.",
        ].join("\n");
      })
  );

  server.tool(
    "plan_next_round",
    "Research team: have the study's agent plan the next round now, from the open questions and the steers nobody has taken up. Replaces any round that is planned but not sent.",
    { study_id: studyId },
    edits,
    async ({ study_id }) =>
      run(async () => {
        const b = await client.api<Board>("POST", `${base(study_id)}/brief/replan`);
        const r = b.nextRound;
        if (!r) return "The study's agent did not produce a round. Try again, or steer it first.";
        return [`Planned round ${r.number} (${r.kind}) · round_id: ${r.id}`, r.rationale ? `Why: ${r.rationale}` : "", ...asksLines(r.asks), `Cost: ${costLine(r.cost, b.rewards.currency)}`, "Next: edit_round to change wording or the reward, send_round to send it, dismiss_round to drop it."]
          .filter(Boolean)
          .join("\n");
      })
  );

  server.tool(
    "edit_round",
    "Research team: change a planned round before it goes out: reword asks, or set what it pays per answer. An ask aimed at several people shares one wording; rewording it changes it for all of them.",
    {
      study_id: studyId,
      round_id: z.string().min(8).describe("From get_study or plan_next_round."),
      asks: z.array(z.object({ ask_id: z.string().min(8), text: z.string().min(8).max(500) })).max(20).optional(),
      reward_per_answer: z.number().min(0).max(500).nullable().optional().describe("Major units (10 = $10); 0 or null makes the round unpaid."),
    },
    edits,
    async ({ study_id, round_id, asks, reward_per_answer }) =>
      run(async () => {
        if (!asks?.length && reward_per_answer === undefined) return "Nothing to change: pass `asks`, `reward_per_answer`, or both.";
        const body: { asks?: { id: string; text: string }[]; rewardCents?: number | null } = {};
        if (asks?.length) {
          // One wording can stand for one ask per person; find every row that shares it.
          const rounds = await client.api<{ rounds: { id: string; asks: { id: string; text: string }[] }[] }>("GET", `${base(study_id)}/rounds`);
          const round = rounds.rounds.find((r) => r.id === round_id);
          if (!round) return "That round is not on this study. Check the round_id with get_study.";
          body.asks = [];
          for (const edit of asks) {
            const anchor = round.asks.find((a) => a.id === edit.ask_id);
            if (!anchor) return `Ask ${edit.ask_id} is not in that round. Check the ask ids with get_study.`;
            for (const a of round.asks.filter((x) => x.text === anchor.text)) body.asks.push({ id: a.id, text: edit.text });
          }
        }
        if (reward_per_answer !== undefined) body.rewardCents = toCents(reward_per_answer) || null;
        await client.api("PUT", `${base(study_id)}/rounds/${encodeURIComponent(round_id)}`, body);
        const b = await client.api<Board>("GET", `${base(study_id)}/brief`);
        const r = b.nextRound;
        return r ? [`Round ${r.number} now reads:`, ...asksLines(r.asks), `Cost: ${costLine(r.cost, b.rewards.currency)}`].join("\n") : "Updated.";
      })
  );

  server.tool(
    "send_round",
    "Research team: send a planned round. THIS REACHES REAL PEOPLE: every participant it is aimed at is notified and asked to answer, and each accepted answer commits the round's reward from the study's budget. It cannot be unsent. Only call it when your person has asked for this round to go out. Refused if the round cannot fit the budget.",
    {
      study_id: studyId,
      round_id: z.string().min(8),
      reward_per_answer: z.number().min(0).max(500).nullable().optional().describe("Set the reward as it goes out, in major units; left out, the planned reward stands."),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async ({ study_id, round_id, reward_per_answer }) =>
      run(async () => {
        const res = await client.api<{ notified: number; round: { number: number; reward_cents: number | null } }>(
          "POST",
          `${base(study_id)}/rounds/${encodeURIComponent(round_id)}/approve`,
          reward_per_answer === undefined ? {} : { rewardCents: toCents(reward_per_answer) || null }
        );
        return `Round ${res.round.number} is out to ${people(res.notified)}${res.round.reward_cents ? ` at ${money(res.round.reward_cents)} per answer` : ", unpaid"}. Every open steer is now marked as taken up by it. The report and the questions' statuses update as answers come in; get_study_changes shows what moved.`;
      })
  );

  server.tool(
    "dismiss_round",
    "Research team: drop a planned round without sending it. Steers stay open and are worked into the next plan.",
    { study_id: studyId, round_id: z.string().min(8) },
    edits,
    async ({ study_id, round_id }) =>
      run(async () => {
        await client.api("POST", `${base(study_id)}/rounds/${encodeURIComponent(round_id)}/reject`);
        return "Dismissed. Nothing was sent. plan_next_round asks for a new plan.";
      })
  );

  // ── Research team: people ─────────────────────────────────────────────

  server.tool(
    "add_participants",
    "Research team: bring the people a study will hear from into it. Each needs a name, a phone or an email. Give a `segment` (e.g. \"Customer\", \"Competitor user\") so findings can be cut by it and rounds aimed at it. If someone was already interviewed elsewhere, pass the `transcript`: it is filed as an imported interview the study's agent reads. Returns each person's personal link to send them; only answers through a personal link are paid.",
    {
      study_id: studyId,
      participants: z
        .array(
          z.object({
            name: z.string().max(120).optional(),
            phone: z.string().max(40).optional().describe("With country code. A participant with a phone also gets round notices on WhatsApp."),
            email: z.string().max(200).optional(),
            segment: z.string().max(60).optional(),
            descriptor: z.string().max(200).optional().describe("One line about them, e.g. \"VP Eng, 200-person fintech\". The client never sees it."),
            transcript: z.string().max(120000).optional().describe("A prior interview with this person."),
            publish_consent: z.enum(["none", "quote", "voice"]).optional().describe("What they agreed to in that interview about public use; default none."),
          })
        )
        .min(1)
        .max(200),
    },
    edits,
    async ({ study_id, participants }) =>
      run(async () => {
        const res = await client.api<{ participants: { name: string | null; segment: string | null; link: string; added: boolean; transcriptImported: boolean }[]; skipped: { row: number; reason: string }[] }>(
          "POST",
          `${base(study_id)}/participants`,
          { participants: participants.map(({ publish_consent, ...p }) => ({ ...p, publishConsent: publish_consent })) }
        );
        return [
          `${res.participants.length} in the study (${res.participants.filter((p) => p.added).length} new, ${res.participants.filter((p) => p.transcriptImported).length} with an imported interview).`,
          ...res.participants.map((p) => `- ${p.name ?? "(no name)"}${p.segment ? ` (${p.segment})` : ""}: ${p.link}`),
          ...(res.skipped.length ? ["Skipped:", ...res.skipped.map((s) => `- row ${s.row}: ${s.reason}`)] : []),
          "",
          "Each link is personal and is what makes that person payable: send each to its owner only, and treat them as secrets.",
        ].join("\n");
      })
  );

  server.tool(
    "create_invite",
    "Research team: get the invite link for the client's team or for a co-researcher. One reusable link per role. Inviting a client makes the study a sponsored one: from then on participants are told who hears their answers, and the client only ever hears answers given after that.",
    {
      study_id: studyId,
      role: z.enum(["client", "researcher"]),
      sponsor: z.string().max(80).optional().describe("For a client invite: the name participants are shown. Left out, \"the company that commissioned this research\"."),
    },
    edits,
    async ({ study_id, role, sponsor }) =>
      run(async () => {
        const res = await client.api<{ link: string; uses: number; sponsor: string | null }>("POST", `${base(study_id)}/invites`, { role: role === "client" ? "client" : "admin", sponsorName: sponsor });
        return role === "client"
          ? `Client invite: ${res.link} (used ${res.uses} time${res.uses === 1 ? "" : "s"}). Participants are now told that ${res.sponsor} hears their answers. A person opens it in a browser; an agent takes the seat with join_study.`
          : `Co-researcher invite: ${res.link} (used ${res.uses} time${res.uses === 1 ? "" : "s"}). Whoever holds it joins the research team with full rights, so share it carefully.`;
      })
  );

  // ── Research team: testimonials and clips ─────────────────────────────

  server.tool(
    "plan_testimonial_round",
    "Research team: have the study's agent plan a testimonial round. It reads the answers, picks the participants who were clearly positive (narrow it with `who`, e.g. \"people who were happy with onboarding\"), and writes each of them one short ask for a line in their own words that can be used in public. On the ask they are told who may use the recording and that it pays the bonus; recording it is their consent and they may decline. Nothing is sent by this call: review the plan, then send_round. Replaces any round that is planned but not sent. Takes 10 to 20 seconds.",
    {
      study_id: studyId,
      who: z.string().max(300).optional().describe("Who to ask, in a phrase. Left out: everyone who was clearly positive."),
      bonus: z.number().min(0).max(500).optional().describe("What recording the testimonial pays, in major units (15 = $15). Left out: the study's default reward."),
    },
    edits,
    async ({ study_id, who, bonus }) =>
      run(async () => {
        await client.api("POST", `${base(study_id)}/rounds/propose`, { purpose: "testimonial", hint: who, rewardCents: toCents(bonus) ?? undefined });
        const b = await client.api<Board>("GET", `${base(study_id)}/brief`);
        const r = b.nextRound;
        if (!r) return "The study's agent did not produce a testimonial round.";
        return [
          `Planned testimonial round ${r.number} · round_id: ${r.id} · ${people(r.asks.reduce((n, a) => n + Math.max(1, a.targets.length), 0))} to ask`,
          r.rationale ? `Why these people: ${r.rationale}` : "",
          ...asksLines(r.asks),
          `Each is told: "${b.survey.testimonialNotice ?? "This recording may be used in public marketing material."}"`,
          `Bonus: ${costLine(r.cost, b.rewards.currency)}`,
          "Nothing has been sent. edit_round changes a wording or the bonus; send_round sends it (it reaches real people and commits the bonus); dismiss_round drops it. What comes back shows in get_clips.",
        ]
          .filter(Boolean)
          .join("\n");
      })
  );

  server.tool(
    "get_clips",
    "Research team: every line and recording that its speaker allowed to be used in public: testimonials recorded for that purpose, and ordinary answers whose speaker said yes on the consent screen. For each: who said it, the words, whether the recording itself may be used or only the words (unnamed), whether it was recorded for a bonus (an incentivised line: say so wherever it is published), what the person was told, and a download link for the audio that works for one hour.",
    { study_id: studyId },
    readOnly,
    async ({ study_id }) =>
      run(async () => {
        const res = await client.api<{ clips: Clip[]; currency: string }>("GET", `${base(study_id)}/clips`);
        if (res.clips.length === 0) {
          return "Nothing is cleared for public use yet. A participant can allow it on the consent screen, or plan_testimonial_round asks the people who were positive for a line.";
        }
        return [
          `${res.clips.length} cleared for public use:`,
          ...res.clips.map((c) =>
            [
              `\n[answer ${c.id}] ${c.who}${c.segment ? ` (${c.segment})` : ""} · ${c.testimonial ? "TESTIMONIAL" : c.roundNumber === 0 ? "imported interview" : `round ${c.roundNumber}`}${
                c.verdict && c.verdict !== "answered"
                  ? ` · ${
                      c.testimonial
                        ? c.verdict === "partial"
                          ? "a weak testimonial"
                          : "does not read as a testimonial"
                        : c.verdict === "partial"
                          ? "partly on the ask"
                          : "not on the ask"
                    }`
                  : ""
              }`,
              `Asked: ${c.questionText}`,
              `Said: ${c.transcription?.trim() ?? ""}`,
              `May be used: ${c.publishConsent === "voice" ? "the recording and the words" : "the words only, without the name (the recording stays inside the study)"}`,
              c.incentivised ? `Incentivised: recorded for a ${money(c.bonusCents, res.currency)} bonus. Disclose that wherever it is published.` : "",
              c.notice ? `They were told: "${c.notice}"` : "",
              c.audioUsable && c.audioUrl ? `Audio (link valid one hour): ${c.audioUrl}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          ),
          "",
          "Names are shown to the research team so a clip can be cleared with the person; only \"the recording and the words\" clips may carry a voice in public.",
        ].join("\n");
      })
  );

  // ── Research team: the report and rewards ─────────────────────────────

  server.tool(
    "refresh_study_report",
    "Research team: have the study's agent re-read every answer now, rewrite the report and update each question's status, instead of waiting for its usual few minutes after an answer. Takes up to a minute.",
    { study_id: studyId },
    edits,
    async ({ study_id }) =>
      run(async () => {
        const res = await client.api<{ ok: boolean; answersRead: number; error?: string }>("POST", `${base(study_id)}/agent/digest`);
        return res.answersRead === 0 ? "No answers to read yet." : `Read ${res.answersRead} answers and rewrote the report. get_study shows the questions' new statuses; get_study_report has the text.`;
      })
  );

  server.tool(
    "get_rewards",
    "Research team: the study's reward ledger: what has been paid, what is owed, what is left of the budget, and every reward that needs a look (held because the answer was too short, off topic, or over budget; or failed at the payout provider).",
    { study_id: studyId },
    readOnly,
    async ({ study_id }) =>
      run(async () => {
        const res = await client.api<{ summary: Rewards; rewards: { id: string; name: string | null; segment: string | null; roundNumber: number; amountCents: number; currency: string; status: string; holdReason: string | null; holdNote?: string | null; error: string | null; claimedAt: string | null }[] }>(
          "GET",
          `${base(study_id)}/rewards`
        );
        const s = res.summary;
        const reason = (r: { status: string; holdReason: string | null; holdNote?: string | null; error: string | null }) =>
          r.status === "failed"
            ? `failed: ${r.error ?? "unknown"}`
            : r.holdReason === "too_short"
            ? "held: the answer was only a few words"
            : r.holdReason === "unanswered"
            ? `held: "${r.holdNote ?? "one of the asks"}" was judged not answered (get_study_answers shows what was said and any follow-ups the agent asked; read it before deciding)`
            : r.holdReason === "off_topic"
            ? "held: the answer did not speak to the question"
            : r.holdReason === "over_budget"
            ? "held: would take the study over budget"
            : r.status;
        const attention = res.rewards.filter((r) => r.status === "held" || r.status === "failed");
        return [
          `Paid out ${money(s.sentCents, s.currency)} · owed ${money(s.owedCents, s.currency)} · ${s.remainingCents === null ? "no budget set" : `${money(s.remainingCents, s.currency)} left of ${money(s.budgetCents ?? 0, s.currency)}`} · default ${s.defaultCents ? money(s.defaultCents, s.currency) : "none"} per answer`,
          s.payouts === null ? "Payouts are not connected: rewards are recorded and wait as owed, nobody is paid yet." : s.payouts === "sandbox" ? "Sandbox payouts: no real money moves." : "Live payouts.",
          attention.length ? `\nNeeds a look (${attention.length}); decide with review_reward:` : "\nNothing needs a look.",
          ...attention.map((r) => `- [reward ${r.id}] ${r.name ?? "Participant"}${r.segment ? ` (${r.segment})` : ""} · round ${r.roundNumber} · ${money(r.amountCents, r.currency)} · ${reason(r)}`),
          `\nAll rewards (${res.rewards.length}):`,
          ...res.rewards.slice(0, 50).map((r) => `- ${r.name ?? "Participant"} · round ${r.roundNumber} · ${money(r.amountCents, r.currency)} · ${r.status === "sent" ? (r.claimedAt ? "claimed" : "sent, not claimed yet") : r.status === "approved" ? "owed" : r.status === "void" ? "not paid" : r.status}`),
        ].join("\n");
      })
  );

  server.tool(
    "set_reward_settings",
    "Research team: set the study's reward budget and the default reward per answer for new rounds, in major units (50 = $50). Pass null to remove a value.",
    {
      study_id: studyId,
      budget: z.number().min(0).max(1_000_000).nullable().optional(),
      default_reward: z.number().min(0).max(500).nullable().optional(),
    },
    edits,
    async ({ study_id, budget, default_reward }) =>
      run(async () => {
        if (budget === undefined && default_reward === undefined) return "Nothing to change: pass `budget`, `default_reward`, or both.";
        const res = await client.api<{ summary: Rewards }>("PUT", `${base(study_id)}/rewards/settings`, { budgetCents: toCents(budget), defaultCents: toCents(default_reward) });
        const s = res.summary;
        return `Budget ${s.budgetCents === null ? "none" : money(s.budgetCents, s.currency)}${s.remainingCents === null ? "" : ` (${money(s.remainingCents, s.currency)} left)`}; default reward ${s.defaultCents ? money(s.defaultCents, s.currency) : "none"} per answer.`;
      })
  );

  server.tool(
    "review_reward",
    "Research team: decide a reward that is held or failed (from get_rewards). `pay` releases it to the participant: THIS MOVES MONEY once payouts are connected, so only call it when your person has decided. `void` cancels it; the participant is not paid for that round.",
    { study_id: studyId, reward_id: z.string().min(8), decision: z.enum(["pay", "void"]) },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async ({ study_id, reward_id, decision }) =>
      run(async () => {
        const res = await client.api<{ status: string; error: string | null }>("POST", `${base(study_id)}/rewards/${encodeURIComponent(reward_id)}/${decision === "pay" ? "release" : "void"}`);
        if (decision === "void") return "Voided. That participant is not paid for that round.";
        return res.status === "sent" ? "Paid: the participant can claim it from their link." : res.status === "approved" ? "Approved and owed. It goes out when payouts are connected." : `Released, but the payout did not go through: ${res.error ?? res.status}.`;
      })
  );
}

/** How the server introduces itself: read by the connecting agent before any tool call. */
export const STUDY_INSTRUCTIONS = [
  "Parlo runs research studies with a brief that keeps moving while people are being heard. A study has a research team and usually a client (the company that commissioned it); participants answer short voice questions in rounds, and the study's own agent reads the answers, keeps a report, and plans the next round.",
  "You are here as someone's agent, with their seat. Both seats can read everything, add, reword and drop the questions the study must answer, and steer (\"dig into this\"). Only the research team plans, prices and sends rounds, brings participants in, invites people and handles rewards. The server refuses what your seat cannot do and says why.",
  "How to work: list_studies → get_study (read before you change anything) → then add_study_question, update_study_question, steer_study. After a change the study's agent re-plans in about half a minute; get_study again to read the plan, get_study_changes to see what others did since you last looked. Everything you change is logged with your person's name and marked as made by their agent, and the other side is told.",
  "No seat yet? join_study takes one from an invite link. Starting from nothing? create_study.",
  "send_round and review_reward (pay) reach real people and commit money. Call them only when your person asked for exactly that.",
  "The client hears voices, not names: participants appear to a client as labels like \"Customer 3\". Each answer says whether it may be published (none, quote, voice); only quote and voice answers may be used in anything public.",
  "Answers are judged against their question. Inside a sitting the study's agent asks up to two follow-ups when an answer falls short, then lets go; get_study_answers shows the follow-ups and whether the question ended up answered. Pay follows that: a round with an ask left unanswered is held for the research team to pay or void (get_rewards, review_reward). To get public lines, plan_testimonial_round asks the people who were positive, for a bonus; get_clips lists what may be used and what was paid for it.",
].join("\n");

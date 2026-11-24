/**
 * The research studio: the living brief, the people around it, and the raw
 * answers as the team hears them.
 *
 *   /api/my/surveys/:id/brief…        the research team and the client ("steer")
 *   /api/my/surveys/:id/answers       same
 *   /api/my/surveys/:id/participants  the research team ("manage")
 *   /api/my/surveys/:id/invites       the research team
 *   /api/join/:token                  whoever holds an invite link
 *   /api/studies                      anyone signed in: start a study in one call
 *
 * A request that carries `X-Parlo-Client: mcp…` comes from someone's AI
 * agent through the MCP server; the changes it makes are logged as such.
 */

import { Hono } from "hono";
import { getAgentByName } from "agents";
import type { Env, GroupRole, Survey } from "../types";
import type { AuthVariables } from "../middleware/auth";
import { requireSeat, type AppContext, type Seat } from "../services/access";
import { canManage, displayNameFor, ensureApiKey, ensureMember, updateUserNames, upsertUserByPhone } from "../services/groups";
import { ensureRound1, setRoundReward } from "../services/rounds";
import { generateQuestionsFromBrief, type GeneratedSurvey } from "../services/ai";
import { BRIEF_MAX_CHARS } from "../services/brief";
import { buildShareUrl } from "../services/slug";
import { sanitizeCents } from "../services/rewards";
import { replaceQuestions } from "./surveys";
import {
  addItem,
  ensureSeeded,
  eventsSince,
  getItem,
  listAnswers,
  listItems,
  LIVE_STATUSES,
  loadBoard,
  logEvent,
  MAX_GOAL_CHARS,
  MAX_ITEM_CHARS,
  MAX_LIVE_ITEMS,
  MAX_STEER_CHARS,
  originFor,
} from "../services/briefBoard";
import { importParticipants, MAX_IMPORT, type ParticipantInput } from "../services/participants";
import { notifyUsers } from "../services/notify";
import { generateCode, generateId } from "../services/codes";
import { PhoneProofError, resolveVerifiedPhone } from "../services/phoneProof";
import { checkRateLimit } from "../services/ratelimit";
import { trackServerEvent } from "../services/analytics";

const study = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

function baseUrlOf(c: AppContext) {
  return new URL(c.req.url).origin;
}

/** 'agent' when the request came through the MCP server, from someone's AI agent. Attribution only, not a permission. */
function viaOf(c: AppContext): "agent" | null {
  return (c.req.header("X-Parlo-Client") ?? "").toLowerCase().startsWith("mcp") ? "agent" : null;
}

/** Everyone on the other side of the table from the actor, for the Inbox. */
async function otherSide(db: D1Database, surveyId: string, actor: { user_id: string; role: GroupRole }): Promise<string[]> {
  const roles = actor.role === "client" ? "('owner', 'admin')" : "('client')";
  const r = await db
    .prepare(`SELECT user_id FROM group_members WHERE survey_id = ? AND removed_at IS NULL AND role IN ${roles} AND user_id != ?`)
    .bind(surveyId, actor.user_id)
    .all<{ user_id: string }>();
  return r.results.map((x) => x.user_id);
}

async function actorName(db: D1Database, userId: string): Promise<string | null> {
  const u = await db
    .prepare("SELECT first_name, last_name, wa_name, linkedin_name, phone FROM users WHERE id = ?")
    .bind(userId)
    .first<{ first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null }>();
  return u ? displayNameFor(u) : null;
}

/**
 * The brief moved: tell the other side, and have the agent work it into the
 * plan for the next round (debounced inside the agent).
 */
async function afterBriefChange(c: AppContext, gate: Seat, line: string, body: string | null) {
  const surveyId = gate.survey.id;
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const person = (await actorName(c.env.DB, gate.membership.user_id)) ?? (gate.membership.role === "client" ? "The client" : "A researcher");
        const who = viaOf(c) ? `${person}'s agent` : person;
        await notifyUsers(c.env.DB, await otherSide(c.env.DB, surveyId, gate.membership), {
          type: "brief_update",
          title: `${who} ${line} in ${gate.survey.title ?? "your study"}`,
          body,
          surveyId,
          surveyTitle: gate.survey.title,
        });
        const agent = await getAgentByName(c.env.GROUP_AGENT, surveyId);
        await agent.scheduleReplan(surveyId);
      } catch (err) {
        console.error("[study] afterBriefChange failed", err);
      }
    })()
  );
}

async function board(c: AppContext, gate: Seat) {
  const survey = (await c.env.DB.prepare("SELECT * FROM surveys WHERE id = ?").bind(gate.survey.id).first<Survey>()) ?? gate.survey;
  return loadBoard(c.env, survey, gate.membership, baseUrlOf(c));
}

// ── The brief ────────────────────────────────────────────────────────

study.get("/api/my/surveys/:surveyId/brief", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  await ensureSeeded(c.env, gate.survey);
  return c.json(await board(c, gate));
});

study.put("/api/my/surveys/:surveyId/brief/goal", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ goal?: string }>().catch(() => ({} as { goal?: string }));
  const goal = typeof body.goal === "string" ? body.goal.trim().slice(0, MAX_GOAL_CHARS) : "";
  if (goal.length < 10) return c.json({ error: "Say what the study is for in a sentence or two" }, 400);
  if (goal === (gate.survey.brief ?? "").trim()) return c.json(await board(c, gate));
  await c.env.DB.prepare("UPDATE surveys SET brief = ? WHERE id = ?").bind(goal, gate.survey.id).run();
  await logEvent(c.env.DB, gate.survey.id, { via: viaOf(c), type: "goal_edited", actorId: gate.membership.user_id, actorRole: gate.membership.role, body: goal });
  trackServerEvent(gate.membership.user_id, "brief_goal_edited", { surveyId: gate.survey.id, role: gate.membership.role });
  await afterBriefChange(c, gate, "rewrote what the study is for", goal.slice(0, 160));
  return c.json(await board(c, gate));
});

study.post("/api/my/surveys/:surveyId/brief/items", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
  const text = typeof body.text === "string" ? body.text.trim().replace(/\s+/g, " ").slice(0, MAX_ITEM_CHARS) : "";
  if (text.length < 8) return c.json({ error: "Write the question the study should answer" }, 400);
  const live = (await listItems(c.env.DB, gate.survey.id)).filter((i) => LIVE_STATUSES.includes(i.status));
  if (live.length >= MAX_LIVE_ITEMS) return c.json({ error: `A brief holds up to ${MAX_LIVE_ITEMS} questions. Drop one first.` }, 400);
  const item = await addItem(c.env.DB, gate.survey.id, { text, origin: originFor(gate.membership.role), createdBy: gate.membership.user_id });
  await logEvent(c.env.DB, gate.survey.id, { via: viaOf(c), type: "item_added", actorId: gate.membership.user_id, actorRole: gate.membership.role, itemId: item.id, body: text });
  trackServerEvent(gate.membership.user_id, "brief_item_added", { surveyId: gate.survey.id, role: gate.membership.role, via: viaOf(c) ?? "app" });
  await afterBriefChange(c, gate, "added a question to the brief", text);
  return c.json(await board(c, gate), 201);
});

study.put("/api/my/surveys/:surveyId/brief/items/:itemId", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const item = await getItem(c.env.DB, gate.survey.id, c.req.param("itemId"));
  if (!item) return c.json({ error: "That question is not on this brief" }, 404);
  const body = await c.req.json<{ text?: string; status?: string }>().catch(() => ({} as { text?: string; status?: string }));
  const actor = { actorId: gate.membership.user_id, actorRole: gate.membership.role, itemId: item.id, via: viaOf(c) };

  if (typeof body.text === "string") {
    const text = body.text.trim().replace(/\s+/g, " ").slice(0, MAX_ITEM_CHARS);
    if (text.length < 8) return c.json({ error: "Write the question the study should answer" }, 400);
    if (text !== item.text) {
      await c.env.DB.prepare("UPDATE brief_items SET text = ?, updated_at = datetime('now') WHERE id = ?").bind(text, item.id).run();
      await logEvent(c.env.DB, gate.survey.id, { ...actor, type: "item_edited", body: text });
      await afterBriefChange(c, gate, "reworded a question on the brief", text);
    }
  }

  if (body.status !== undefined) {
    if (body.status !== "open" && body.status !== "answered" && body.status !== "dropped") {
      return c.json({ error: "status must be 'open', 'answered' or 'dropped'" }, 400);
    }
    if (!LIVE_STATUSES.includes(item.status) && item.status !== "dropped") return c.json({ error: "Accept or dismiss a suggestion first" }, 400);
    if (body.status !== item.status) {
      // Reopening hands the status back to the agent; answered and dropped are a person's call and stay put.
      await c.env.DB
        .prepare("UPDATE brief_items SET status = ?, status_by = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(body.status, body.status === "open" ? "agent" : "human", item.id)
        .run();
      const type = body.status === "dropped" ? "item_dropped" : body.status === "answered" ? "item_answered" : "item_reopened";
      await logEvent(c.env.DB, gate.survey.id, { ...actor, type, body: item.text });
      trackServerEvent(gate.membership.user_id, "brief_item_status_set", { surveyId: gate.survey.id, role: gate.membership.role, status: body.status });
      const line = body.status === "dropped" ? "dropped a question from the brief" : body.status === "answered" ? "marked a question answered" : "reopened a question";
      await afterBriefChange(c, gate, line, item.text);
    }
  }
  return c.json(await board(c, gate));
});

/** The agent suggested a question people keep raising; someone on the team says yes or no. */
study.post("/api/my/surveys/:surveyId/brief/items/:itemId/:verdict{accept|dismiss}", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const item = await getItem(c.env.DB, gate.survey.id, c.req.param("itemId"));
  if (!item) return c.json({ error: "That question is not on this brief" }, 404);
  if (item.status !== "suggested") return c.json({ error: "That suggestion was already answered" }, 409);
  const accept = c.req.param("verdict") === "accept";
  if (accept) {
    const live = (await listItems(c.env.DB, gate.survey.id)).filter((i) => LIVE_STATUSES.includes(i.status));
    if (live.length >= MAX_LIVE_ITEMS) return c.json({ error: `A brief holds up to ${MAX_LIVE_ITEMS} questions. Drop one first.` }, 400);
  }
  await c.env.DB
    .prepare("UPDATE brief_items SET status = ?, status_by = 'agent', updated_at = datetime('now') WHERE id = ?")
    .bind(accept ? "open" : "dismissed", item.id)
    .run();
  await logEvent(c.env.DB, gate.survey.id, { via: viaOf(c),
    type: accept ? "suggestion_accepted" : "suggestion_dismissed",
    actorId: gate.membership.user_id,
    actorRole: gate.membership.role,
    itemId: item.id,
    body: item.text,
  });
  trackServerEvent(gate.membership.user_id, accept ? "brief_suggestion_accepted" : "brief_suggestion_dismissed", { surveyId: gate.survey.id, role: gate.membership.role });
  if (accept) await afterBriefChange(c, gate, "took up the agent's suggestion", item.text);
  return c.json(await board(c, gate));
});

/** "Dig into this." A note the agent works into the next round, on a question or on the study as a whole. */
study.post("/api/my/surveys/:surveyId/brief/steer", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ note?: string; itemId?: string | null }>().catch(() => ({} as { note?: string; itemId?: string | null }));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_STEER_CHARS) : "";
  if (note.length < 4) return c.json({ error: "Tell the agent what to dig into" }, 400);
  let itemId: string | null = null;
  if (body.itemId) {
    const item = await getItem(c.env.DB, gate.survey.id, body.itemId);
    if (!item) return c.json({ error: "That question is not on this brief" }, 404);
    itemId = item.id;
  }
  await logEvent(c.env.DB, gate.survey.id, { via: viaOf(c), type: "steer", actorId: gate.membership.user_id, actorRole: gate.membership.role, itemId, body: note });
  trackServerEvent(gate.membership.user_id, "brief_steered", { surveyId: gate.survey.id, role: gate.membership.role, onItem: !!itemId, via: viaOf(c) ?? "app" });
  await afterBriefChange(c, gate, "steered the study", note);
  return c.json(await board(c, gate), 201);
});

/** What changed on the brief since a moment (ISO), oldest first. For an agent that comes back and wants only the news. */
study.get("/api/my/surveys/:surveyId/brief/events", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const limit = parseInt(c.req.query("limit") ?? "100", 10) || 100;
  const events = await eventsSince(c.env.DB, gate.survey, gate.membership, c.req.query("since") ?? null, limit);
  return c.json({ events, now: new Date().toISOString() });
});

/** A researcher asks for the plan now instead of waiting for the agent's debounce. */
study.post("/api/my/surveys/:surveyId/brief/replan", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "manage");
  if (gate instanceof Response) return gate;
  const agent = await getAgentByName(c.env.GROUP_AGENT, gate.survey.id);
  const result = await agent.proposeRound(gate.survey.id, {});
  if (!result.ok) return c.json({ error: result.error ?? "The agent couldn't plan a round" }, 502);
  trackServerEvent(gate.membership.user_id, "round_proposal_requested", { surveyId: gate.survey.id, kind: result.round?.kind, from: "brief" });
  return c.json(await board(c, gate));
});

// ── Raw answers ──────────────────────────────────────────────────────

study.get("/api/my/surveys/:surveyId/answers", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const limit = parseInt(c.req.query("limit") ?? "30", 10) || 30;
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
  const result = await listAnswers(c.env, gate.survey, gate.membership, baseUrlOf(c), { limit, offset });
  if (gate.membership.role === "client") trackServerEvent(gate.membership.user_id, "client_answers_opened", { surveyId: gate.survey.id, offset });
  return c.json(result);
});

// ── Participants ─────────────────────────────────────────────────────

study.post("/api/my/surveys/:surveyId/participants", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "manage");
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ participants?: ParticipantInput[] }>().catch(() => ({} as { participants?: ParticipantInput[] }));
  if (!Array.isArray(body.participants) || body.participants.length === 0) return c.json({ error: "participants is required" }, 400);
  if (body.participants.length > MAX_IMPORT) return c.json({ error: `Up to ${MAX_IMPORT} people at a time` }, 400);
  const result = await importParticipants(c.env, gate.survey, gate.membership.user_id, body.participants);
  trackServerEvent(gate.membership.user_id, "participants_imported", {
    surveyId: gate.survey.id,
    added: result.participants.filter((p) => p.added).length,
    transcripts: result.participants.filter((p) => p.transcriptImported).length,
    skipped: result.skipped.length,
  });
  return c.json(result, 201);
});

// ── Invites ──────────────────────────────────────────────────────────

interface InviteRow {
  token: string;
  survey_id: string;
  role: "admin" | "client";
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  uses: number;
}

function inviteLink(env: Env, token: string) {
  return `${(env.FRONTEND_ORIGIN ?? "https://parlo.me").replace(/\/+$/, "")}/join/${token}`;
}

study.get("/api/my/surveys/:surveyId/invites", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "manage");
  if (gate instanceof Response) return gate;
  const rows = await c.env.DB
    .prepare("SELECT * FROM invites WHERE survey_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
    .bind(gate.survey.id)
    .all<InviteRow>();
  return c.json({
    sponsor: gate.survey.sponsor_name ?? null,
    invites: rows.results.map((i) => ({ token: i.token, role: i.role, link: inviteLink(c.env, i.token), uses: i.uses, createdAt: i.created_at })),
  });
});

/**
 * One link per seat kind, reused: a client team shares theirs, co-researchers
 * theirs. Inviting a client makes the study a sponsored one, which changes
 * the consent line participants see from then on.
 */
study.post("/api/my/surveys/:surveyId/invites", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "manage");
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ role?: string; sponsorName?: string }>().catch(() => ({} as { role?: string; sponsorName?: string }));
  if (body.role !== "client" && body.role !== "admin") return c.json({ error: "role must be 'client' or 'admin'" }, 400);

  let sponsor = gate.survey.sponsor_name ?? null;
  if (body.role === "client") {
    const named = typeof body.sponsorName === "string" ? body.sponsorName.trim().replace(/\s+/g, " ").slice(0, 80) : "";
    if (named && named !== sponsor) {
      sponsor = named;
      await c.env.DB.prepare("UPDATE surveys SET sponsor_name = ? WHERE id = ?").bind(sponsor, gate.survey.id).run();
    } else if (!sponsor) {
      sponsor = "the company that commissioned this research";
      await c.env.DB.prepare("UPDATE surveys SET sponsor_name = ? WHERE id = ?").bind(sponsor, gate.survey.id).run();
    }
  }

  if (body.role === "client") await c.env.DB.prepare("UPDATE surveys SET kind = 'study' WHERE id = ? AND kind IS NULL").bind(gate.survey.id).run();

  let invite = await c.env.DB
    .prepare("SELECT * FROM invites WHERE survey_id = ? AND role = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .bind(gate.survey.id, body.role)
    .first<InviteRow>();
  if (!invite) {
    const token = generateCode(28);
    await c.env.DB.prepare("INSERT INTO invites (token, survey_id, role, created_by) VALUES (?, ?, ?, ?)").bind(token, gate.survey.id, body.role, gate.membership.user_id).run();
    invite = (await c.env.DB.prepare("SELECT * FROM invites WHERE token = ?").bind(token).first<InviteRow>()) as InviteRow;
    trackServerEvent(gate.membership.user_id, "invite_created", { surveyId: gate.survey.id, role: body.role });
  }
  return c.json({ token: invite.token, role: invite.role, link: inviteLink(c.env, invite.token), uses: invite.uses, sponsor }, 201);
});

/**
 * What someone on the team hands their own AI agent so it can work on the
 * study with their seat: the MCP server's address and the invite link for
 * their kind of seat (the agent takes it with the `join_study` tool). The
 * link carries no more than the seat its holder already has.
 */
study.get("/api/my/surveys/:surveyId/agent-access", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const role: "client" | "admin" = gate.membership.role === "client" ? "client" : "admin";
  let invite = await c.env.DB
    .prepare("SELECT * FROM invites WHERE survey_id = ? AND role = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .bind(gate.survey.id, role)
    .first<InviteRow>();
  if (!invite) {
    const token = generateCode(28);
    await c.env.DB.prepare("INSERT INTO invites (token, survey_id, role, created_by) VALUES (?, ?, ?, ?)").bind(token, gate.survey.id, role, gate.membership.user_id).run();
    invite = (await c.env.DB.prepare("SELECT * FROM invites WHERE token = ?").bind(token).first<InviteRow>()) as InviteRow;
  }
  trackServerEvent(gate.membership.user_id, "agent_access_opened", { surveyId: gate.survey.id, role: gate.membership.role });
  return c.json({ mcpUrl: "https://mcp.parlo.me/mcp", inviteLink: inviteLink(c.env, invite.token), seat: role === "client" ? "client" : "research team", studyId: gate.survey.id });
});

study.delete("/api/my/surveys/:surveyId/invites/:token", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "manage");
  if (gate instanceof Response) return gate;
  await c.env.DB
    .prepare("UPDATE invites SET revoked_at = datetime('now') WHERE token = ? AND survey_id = ?")
    .bind(c.req.param("token"), gate.survey.id)
    .run();
  return c.json({ ok: true });
});

async function liveInvite(db: D1Database, token: string): Promise<(InviteRow & { title: string | null; sponsor_name: string | null; code: string }) | null> {
  if (token.length < 16 || token.length > 64) return null;
  return db
    .prepare(
      `SELECT i.*, s.title, s.sponsor_name, s.code FROM invites i JOIN surveys s ON s.id = i.survey_id
       WHERE i.token = ? AND i.revoked_at IS NULL AND s.status != 'deleted'`
    )
    .bind(token)
    .first<InviteRow & { title: string | null; sponsor_name: string | null; code: string }>();
}

study.get("/api/join/:token", async (c) => {
  const invite = await liveInvite(c.env.DB, c.req.param("token"));
  if (!invite) return c.json({ error: "This invite link is no longer valid" }, 404);
  return c.json({
    surveyId: invite.survey_id,
    title: invite.title,
    role: invite.role,
    sponsor: invite.sponsor_name ?? null,
    invitedBy: await actorName(c.env.DB, invite.created_by),
  });
});

/** Take the seat. Identity is a proof, never a typed phone (API key, Firebase ID token or WhatsApp proof). */
study.post("/api/join/:token", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await checkRateLimit(c.env.KV, "invite-join", ip, 30))) return c.json({ error: "Too many attempts. Try again later." }, 429);
  const invite = await liveInvite(c.env.DB, c.req.param("token"));
  if (!invite) return c.json({ error: "This invite link is no longer valid" }, 404);
  type JoinBody = { idToken?: string; proof?: string; firstName?: string; lastName?: string };
  const body = await c.req.json<JoinBody>().catch((): JoinBody => ({}));
  const db = c.env.DB;

  let userId = c.get("userId");
  if (!userId) {
    try {
      const verified = await resolveVerifiedPhone(c.env, body);
      userId = (await upsertUserByPhone(db, verified.phone, { firstName: body.firstName ?? null, lastName: body.lastName ?? null })).id;
    } catch (err) {
      if (err instanceof PhoneProofError) return c.json({ error: err.message, code: err.code }, err.status);
      throw err;
    }
  } else {
    await updateUserNames(db, userId, body.firstName ?? null, body.lastName ?? null);
  }

  const membership = await ensureMember(db, invite.survey_id, userId, invite.role, invite.created_by);
  if (membership.removed_at) return c.json({ error: "You were removed from this study" }, 403);
  let role: GroupRole = membership.role;
  // A participant holding a team invite takes the team seat; an owner or admin keeps theirs.
  if (membership.role === "member") {
    await db.prepare("UPDATE group_members SET role = ? WHERE survey_id = ? AND user_id = ?").bind(invite.role, invite.survey_id, userId).run();
    role = invite.role;
  }
  if (membership.created || membership.role === "member") {
    await db.prepare("UPDATE invites SET uses = uses + 1 WHERE token = ?").bind(invite.token).run();
    const name = (await actorName(db, userId)) ?? "Someone";
    const managers = await db
      .prepare("SELECT user_id FROM group_members WHERE survey_id = ? AND removed_at IS NULL AND role IN ('owner', 'admin') AND user_id != ?")
      .bind(invite.survey_id, userId)
      .all<{ user_id: string }>();
    await notifyUsers(db, managers.results.map((m) => m.user_id), {
      type: "role_changed",
      title: `${name} joined ${invite.title ?? "your study"} as ${invite.role === "client" ? "the client" : "a researcher"}`,
      surveyId: invite.survey_id,
      surveyTitle: invite.title,
    });
    trackServerEvent(userId, "invite_joined", { surveyId: invite.survey_id, role: invite.role });
  }

  const apiKey = await ensureApiKey(db, userId);
  const user = await db.prepare("SELECT phone FROM users WHERE id = ?").bind(userId).first<{ phone: string | null }>();
  const survey = await db.prepare("SELECT dashboard_code FROM surveys WHERE id = ?").bind(invite.survey_id).first<{ dashboard_code: string }>();
  return c.json({
    ok: true,
    apiKey,
    userId,
    phone: user?.phone ?? null,
    surveyId: invite.survey_id,
    role,
    dashboardCode: canManage(role) ? survey?.dashboard_code ?? null : null,
  });
});

// ── Start a study ────────────────────────────────────────────────────

const STUDY_CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD"]);

/**
 * One call from a brief to a study that is ready to work on: the parlo, its
 * first round (the team's own questions when given, else written from the
 * brief), the sponsor, and what a touch pays. The caller owns it. The brief's
 * questions are seeded on the first open of the board.
 */
study.post("/api/studies", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Sign in first: a study belongs to a person" }, 401);
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const [createOk, studyOk] = await Promise.all([checkRateLimit(c.env.KV, "survey-create", ip, 100), checkRateLimit(c.env.KV, "study-create", userId, 30)]);
  if (!createOk || !studyOk) return c.json({ error: "Rate limit exceeded. Try again in an hour." }, 429);

  type Body = { brief?: unknown; title?: unknown; sponsorName?: unknown; rewardCents?: unknown; budgetCents?: unknown; currency?: unknown; questions?: unknown };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, BRIEF_MAX_CHARS) : "";
  if (brief.length < 20) return c.json({ error: "Write the brief: what the study is for, who it should hear from, and what you need to learn." }, 400);
  const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ").slice(0, 120) || null : null;
  const sponsor = typeof body.sponsorName === "string" ? body.sponsorName.trim().replace(/\s+/g, " ").slice(0, 80) || null : null;
  const rewardCents = body.rewardCents === undefined || body.rewardCents === null ? null : sanitizeCents(body.rewardCents);
  const budgetCents = body.budgetCents === undefined || body.budgetCents === null ? null : sanitizeCents(body.budgetCents, 100_000_000);
  if (body.rewardCents != null && rewardCents === null) return c.json({ error: "rewardCents must be a positive number" }, 400);
  if (body.budgetCents != null && budgetCents === null) return c.json({ error: "budgetCents must be a positive number" }, 400);
  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "USD";
  if (!STUDY_CURRENCIES.has(currency)) return c.json({ error: `currency must be one of ${Array.from(STUDY_CURRENCIES).join(", ")}` }, 400);
  const own = Array.isArray(body.questions)
    ? body.questions.filter((q): q is string => typeof q === "string").map((q) => q.trim().replace(/\s+/g, " ").slice(0, 500)).filter((q) => q.length >= 8).slice(0, 12)
    : [];

  // Round 1: the team's own questions when they brought them, else written from the brief.
  let generated: GeneratedSurvey | null = null;
  if (own.length === 0 || !title) {
    try {
      generated = await generateQuestionsFromBrief(c.env.AI, c.env.KV, { brief, clarifications: [] }, c.env.CEREBRAS_API_KEY);
    } catch (err) {
      console.error("[study] question generation failed", err);
      if (own.length === 0) return c.json({ error: "Couldn't write the first round from that brief. Try again, or send your own questions." }, 502);
    }
  }
  const finalTitle = title ?? generated?.title ?? brief.split(/[.!?\n]/)[0].slice(0, 80);
  const round1: GeneratedSurvey = own.length ? { title: finalTitle, questions: own.map((text) => ({ text, hint: "", type: "voice" as const })) } : (generated as GeneratedSurvey);

  const db = c.env.DB;
  const surveyId = generateId();
  const code = generateCode(8);
  const dashboardCode = generateCode(12);
  await db
    .prepare(
      `INSERT INTO surveys (id, code, dashboard_code, creator_id, title, visibility, kind, sponsor_name, brief, brief_clarifications, output_shape, outputs,
                            reward_cents, reward_budget_cents, reward_currency)
       VALUES (?, ?, ?, ?, ?, 'private', 'study', ?, ?, '[]', 'other', '[]', ?, ?, ?)`
    )
    .bind(surveyId, code, dashboardCode, userId, finalTitle, sponsor, brief, rewardCents || null, budgetCents, currency)
    .run();
  await ensureMember(db, surveyId, userId, "owner");
  const first = await ensureRound1(db, surveyId);
  await replaceQuestions(db, surveyId, round1);
  if (rewardCents) await setRoundReward(db, first.id, rewardCents);

  const via = viaOf(c);
  trackServerEvent(userId, "survey_created", { surveyId, code, dashboardCode, viaApiKey: true, via: via === "agent" ? "mcp-study" : "study" });
  trackServerEvent(userId, "study_created", { surveyId, sponsored: !!sponsor, ownQuestions: own.length, rewardCents: rewardCents ?? 0, budgetCents: budgetCents ?? 0, via: via ?? "app" });

  const origin = (c.env.FRONTEND_ORIGIN ?? "https://parlo.me").replace(/\/+$/, "");
  return c.json(
    {
      surveyId,
      code,
      dashboardCode,
      title: finalTitle,
      sponsor,
      questions: round1.questions.map((q) => ({ text: q.text, hint: q.hint ?? "", type: q.type ?? "voice" })),
      studyLink: `${origin}/study/${surveyId}`,
      dashboardLink: `${origin}/d/${dashboardCode}`,
      // The open link works, but only answers through a personal link are paid: import participants to get those.
      shareLink: buildShareUrl(finalTitle, code, origin),
    },
    201
  );
});

export default study;

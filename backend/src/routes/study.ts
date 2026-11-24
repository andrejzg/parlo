/**
 * The research studio: the living brief, the people around it, and the raw
 * answers as the team hears them.
 *
 *   /api/my/surveys/:id/brief…        the research team and the client ("steer")
 *   /api/my/surveys/:id/answers       same
 *   /api/my/surveys/:id/participants  the research team ("manage")
 *   /api/my/surveys/:id/invites       the research team
 *   /api/join/:token                  whoever holds an invite link
 */

import { Hono } from "hono";
import { getAgentByName } from "agents";
import type { Env, GroupRole, Survey } from "../types";
import type { AuthVariables } from "../middleware/auth";
import { requireSeat, type AppContext, type Seat } from "../services/access";
import { canManage, displayNameFor, ensureApiKey, ensureMember, updateUserNames, upsertUserByPhone } from "../services/groups";
import {
  addItem,
  ensureSeeded,
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
import { generateCode } from "../services/codes";
import { PhoneProofError, resolveVerifiedPhone } from "../services/phoneProof";
import { checkRateLimit } from "../services/ratelimit";
import { trackServerEvent } from "../services/analytics";

const study = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

function baseUrlOf(c: AppContext) {
  return new URL(c.req.url).origin;
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
        const who = (await actorName(c.env.DB, gate.membership.user_id)) ?? (gate.membership.role === "client" ? "The client" : "A researcher");
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
  await logEvent(c.env.DB, gate.survey.id, { type: "goal_edited", actorId: gate.membership.user_id, actorRole: gate.membership.role, body: goal });
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
  await logEvent(c.env.DB, gate.survey.id, { type: "item_added", actorId: gate.membership.user_id, actorRole: gate.membership.role, itemId: item.id, body: text });
  trackServerEvent(gate.membership.user_id, "brief_item_added", { surveyId: gate.survey.id, role: gate.membership.role });
  await afterBriefChange(c, gate, "added a question to the brief", text);
  return c.json(await board(c, gate), 201);
});

study.put("/api/my/surveys/:surveyId/brief/items/:itemId", async (c) => {
  const gate = await requireSeat(c, c.req.param("surveyId"), "steer");
  if (gate instanceof Response) return gate;
  const item = await getItem(c.env.DB, gate.survey.id, c.req.param("itemId"));
  if (!item) return c.json({ error: "That question is not on this brief" }, 404);
  const body = await c.req.json<{ text?: string; status?: string }>().catch(() => ({} as { text?: string; status?: string }));
  const actor = { actorId: gate.membership.user_id, actorRole: gate.membership.role, itemId: item.id };

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
  await logEvent(c.env.DB, gate.survey.id, {
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
  await logEvent(c.env.DB, gate.survey.id, { type: "steer", actorId: gate.membership.user_id, actorRole: gate.membership.role, itemId, body: note });
  trackServerEvent(gate.membership.user_id, "brief_steered", { surveyId: gate.survey.id, role: gate.membership.role, onItem: !!itemId });
  await afterBriefChange(c, gate, "steered the study", note);
  return c.json(await board(c, gate), 201);
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

export default study;

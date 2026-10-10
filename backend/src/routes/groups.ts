/**
 * Groups: membership & roles, settings, the group agent, and rounds.
 *
 * Everything under /api/my/... needs an API key (owner/admin/member of the
 * parlo). The two /api/s/:code/... routes are for members arriving through a
 * personal link (`?t=<member token>`).
 */

import { Hono, type Context } from "hono";
import { getAgentByName } from "agents";
import type { Env, GroupMember, GroupVisibility, RoundKind, Survey } from "../types";
import type { AuthVariables } from "../middleware/auth";
import {
  canManage,
  getMemberByToken,
  getMembership,
  GroupPermissionError,
  listMembers,
  removeMember,
  setMemberRole,
  transferOwnership,
} from "../services/groups";
import { getRound, listRounds, roundAsks, setRoundStatus, updateRoundAsks } from "../services/rounds";
import { notifyUsers } from "../services/notify";
import { createWhatsAppClient } from "../services/whatsapp";
import { extractCode } from "../services/slug";
import { generatePresignedReadUrl, generateReadToken } from "../services/r2";
import { trackServerEvent } from "../services/analytics";
import { displayNameFor } from "../services/groups";

const groups = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

type Ctx = Context<{ Bindings: Env; Variables: AuthVariables }>;

async function loadSurvey(c: Ctx, surveyId: string): Promise<Survey | null> {
  return c.env.DB.prepare("SELECT * FROM surveys WHERE id = ? AND status != 'deleted'").bind(surveyId).first<Survey>();
}

/** Resolve the caller's active membership or produce the right error response. */
async function requireMember(c: Ctx, surveyId: string, manage = false): Promise<{ membership: GroupMember; survey: Survey } | Response> {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const survey = await loadSurvey(c, surveyId);
  if (!survey) return c.json({ error: "Parlo not found" }, 404);
  const membership = await getMembership(c.env.DB, surveyId, userId);
  if (!membership) return c.json({ error: "You're not a member of this parlo" }, 403);
  if (manage && !canManage(membership.role)) return c.json({ error: "Only the owner or an admin can do that" }, 403);
  return { membership, survey };
}

function permissionResponse(c: Ctx, err: unknown) {
  if (err instanceof GroupPermissionError) return c.json({ error: err.message }, err.status);
  throw err;
}

// ── Members ──────────────────────────────────────────────────────────

groups.get("/api/my/surveys/:surveyId/members", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId);
  if (gate instanceof Response) return gate;
  const members = await listMembers(c.env.DB, surveyId);
  // Phones are for managers only.
  const safe = canManage(gate.membership.role) ? members : members.map((m) => ({ ...m, phone: null, linkedinEmail: null }));
  return c.json({ members: safe, you: { userId: gate.membership.user_id, role: gate.membership.role } });
});

groups.post("/api/my/surveys/:surveyId/members/:userId/role", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ role?: string }>().catch(() => ({} as { role?: string }));
  if (body.role !== "admin" && body.role !== "member") return c.json({ error: "role must be 'admin' or 'member'" }, 400);
  try {
    await setMemberRole(c.env.DB, surveyId, gate.membership, c.req.param("userId"), body.role);
  } catch (err) {
    return permissionResponse(c, err);
  }
  trackServerEvent(gate.membership.user_id, "group_role_changed", { surveyId, target: c.req.param("userId"), role: body.role });
  await notifyUsers(c.env.DB, [c.req.param("userId")], {
    type: "role_changed",
    title: body.role === "admin" ? `You're now an admin of ${gate.survey.title ?? "a parlo"}` : `You're now a member of ${gate.survey.title ?? "a parlo"}`,
    surveyId,
    surveyTitle: gate.survey.title,
  });
  return c.json({ ok: true });
});

groups.delete("/api/my/surveys/:surveyId/members/:userId", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  try {
    await removeMember(c.env.DB, surveyId, gate.membership, c.req.param("userId"));
  } catch (err) {
    return permissionResponse(c, err);
  }
  trackServerEvent(gate.membership.user_id, "group_member_removed", { surveyId, target: c.req.param("userId") });
  return c.json({ ok: true });
});

groups.post("/api/my/surveys/:surveyId/transfer", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ userId?: string }>().catch(() => ({} as { userId?: string }));
  if (!body.userId) return c.json({ error: "userId is required" }, 400);
  try {
    await transferOwnership(c.env.DB, surveyId, gate.membership, body.userId);
  } catch (err) {
    return permissionResponse(c, err);
  }
  trackServerEvent(gate.membership.user_id, "group_ownership_transferred", { surveyId, to: body.userId });
  await notifyUsers(c.env.DB, [body.userId], {
    type: "role_changed",
    title: `You now own ${gate.survey.title ?? "a parlo"}`,
    surveyId,
    surveyTitle: gate.survey.title,
  });
  return c.json({ ok: true });
});

// ── Settings ─────────────────────────────────────────────────────────

groups.put("/api/my/surveys/:surveyId/settings", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ visibility?: string; title?: string }>().catch(() => ({} as { visibility?: string; title?: string }));
  const updates: string[] = [];
  const binds: (string | null)[] = [];
  if (body.visibility !== undefined) {
    if (body.visibility !== "open" && body.visibility !== "private") return c.json({ error: "visibility must be 'open' or 'private'" }, 400);
    updates.push("visibility = ?");
    binds.push(body.visibility);
  }
  if (typeof body.title === "string") {
    updates.push("title = ?");
    binds.push(body.title.trim().slice(0, 120) || null);
  }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);
  await c.env.DB.prepare(`UPDATE surveys SET ${updates.join(", ")} WHERE id = ?`).bind(...binds, surveyId).run();
  if (body.visibility) trackServerEvent(gate.membership.user_id, "group_visibility_changed", { surveyId, visibility: body.visibility });
  const survey = await loadSurvey(c, surveyId);
  return c.json({ ok: true, visibility: survey?.visibility as GroupVisibility, title: survey?.title ?? null });
});

// ── Agent ────────────────────────────────────────────────────────────

groups.get("/api/my/surveys/:surveyId/agent", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const agent = await getAgentByName(c.env.GROUP_AGENT, surveyId);
  const snapshot = await agent.getSnapshot(surveyId);
  const rounds = await listRounds(c.env.DB, surveyId);
  const withAsks = await Promise.all(
    rounds.map(async (r) => ({ ...r, asks: await roundAsksWithNames(c.env.DB, r.id) }))
  );
  return c.json({ ...snapshot, rounds: withAsks, visibility: gate.survey.visibility });
});

groups.post("/api/my/surveys/:surveyId/agent/digest", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const agent = await getAgentByName(c.env.GROUP_AGENT, surveyId);
  await agent.getSnapshot(surveyId); // binds + syncs
  const result = await agent.runDigest();
  trackServerEvent(gate.membership.user_id, "agent_digest_requested", { surveyId, ok: result.ok });
  return c.json(result, result.ok ? 200 : 502);
});

groups.get("/api/my/surveys/:surveyId/agent/file", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const path = c.req.query("path");
  if (!path || !path.startsWith("/")) return c.json({ error: "path is required" }, 400);
  const agent = await getAgentByName(c.env.GROUP_AGENT, surveyId);
  const file = await agent.readAgentFile(surveyId, path);
  if (!file) return c.json({ error: "No such file" }, 404);
  return c.json(file);
});

// ── Rounds ───────────────────────────────────────────────────────────

async function roundAsksWithNames(db: D1Database, roundId: string) {
  const asks = await roundAsks(db, roundId);
  const targetIds = Array.from(new Set(asks.map((a) => a.target_user_id).filter((x): x is string => !!x)));
  const names = new Map<string, string | null>();
  if (targetIds.length) {
    const rows = await db
      .prepare(`SELECT id, first_name, last_name, wa_name, linkedin_name, phone FROM users WHERE id IN (${targetIds.map(() => "?").join(", ")})`)
      .bind(...targetIds)
      .all<{ id: string; first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null }>();
    for (const r of rows.results) names.set(r.id, displayNameFor(r));
  }
  return asks.map((a) => ({
    id: a.id,
    text: a.text,
    hint: a.hint,
    type: a.question_type,
    sortOrder: a.sort_order,
    targetUserId: a.target_user_id ?? null,
    targetName: a.target_user_id ? names.get(a.target_user_id) ?? null : null,
  }));
}

groups.get("/api/my/surveys/:surveyId/rounds", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const rounds = await listRounds(c.env.DB, surveyId);
  const withAsks = await Promise.all(rounds.map(async (r) => ({ ...r, asks: await roundAsksWithNames(c.env.DB, r.id) })));
  return c.json({ rounds: withAsks });
});

groups.post("/api/my/surveys/:surveyId/rounds/propose", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ kind?: string; hint?: string }>().catch(() => ({} as { kind?: string; hint?: string }));
  const preferKind: RoundKind | undefined = body.kind === "poll" || body.kind === "probe" ? body.kind : undefined;
  const agent = await getAgentByName(c.env.GROUP_AGENT, surveyId);
  const result = await agent.proposeRound(surveyId, { preferKind, hint: typeof body.hint === "string" ? body.hint.slice(0, 500) : undefined });
  if (!result.ok || !result.round) return c.json({ error: result.error ?? "The agent couldn't propose a round" }, 502);
  trackServerEvent(gate.membership.user_id, "round_proposal_requested", { surveyId, kind: result.round.kind });
  return c.json({ round: { ...result.round, asks: await roundAsksWithNames(c.env.DB, result.round.id) } });
});

groups.put("/api/my/surveys/:surveyId/rounds/:roundId", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const round = await getRound(c.env.DB, c.req.param("roundId"));
  if (!round || round.survey_id !== surveyId) return c.json({ error: "Round not found" }, 404);
  if (round.status !== "proposed") return c.json({ error: "Only a proposed round can be edited" }, 400);
  const body = await c.req.json<{ asks?: { id: string; text: string; hint?: string | null }[] }>().catch(() => ({} as { asks?: { id: string; text: string; hint?: string | null }[] }));
  if (!Array.isArray(body.asks)) return c.json({ error: "asks is required" }, 400);
  await updateRoundAsks(c.env.DB, round.id, body.asks);
  return c.json({ round: { ...round, asks: await roundAsksWithNames(c.env.DB, round.id) } });
});

groups.post("/api/my/surveys/:surveyId/rounds/:roundId/reject", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const round = await getRound(c.env.DB, c.req.param("roundId"));
  if (!round || round.survey_id !== surveyId) return c.json({ error: "Round not found" }, 404);
  if (round.status !== "proposed") return c.json({ error: "Only a proposed round can be rejected" }, 400);
  await setRoundStatus(c.env.DB, round.id, "rejected");
  trackServerEvent(gate.membership.user_id, "round_rejected", { surveyId, round: round.number });
  return c.json({ ok: true });
});

/**
 * Approve = send. Marks the round sent and tells the people it's for: every
 * member for a poll, only the targeted members for a probe. Each gets an
 * in-app notification and a WhatsApp template with their personal link.
 */
groups.post("/api/my/surveys/:surveyId/rounds/:roundId/approve", async (c) => {
  const surveyId = c.req.param("surveyId");
  const gate = await requireMember(c, surveyId, true);
  if (gate instanceof Response) return gate;
  const round = await getRound(c.env.DB, c.req.param("roundId"));
  if (!round || round.survey_id !== surveyId) return c.json({ error: "Round not found" }, 404);
  if (round.status !== "proposed") return c.json({ error: "Only a proposed round can be approved" }, 400);

  const asks = await roundAsks(c.env.DB, round.id);
  if (asks.length === 0) return c.json({ error: "This round has no asks" }, 400);
  await setRoundStatus(c.env.DB, round.id, "sent");

  const targets = round.kind === "probe" ? new Set(asks.map((a) => a.target_user_id).filter((x): x is string => !!x)) : null;
  const members = await c.env.DB.prepare(
    `SELECT gm.user_id, gm.access_token, u.phone FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.survey_id = ? AND gm.removed_at IS NULL`
  )
    .bind(surveyId)
    .all<{ user_id: string; access_token: string; phone: string | null }>();
  const recipients = members.results.filter((m) => m.user_id !== gate.membership.user_id && (!targets || targets.has(m.user_id)));

  const title = gate.survey.title ?? "your parlo";
  await notifyUsers(
    c.env.DB,
    recipients.map((r) => r.user_id),
    {
      type: "new_round",
      title: round.kind === "probe" ? `The agent has a follow-up question for you in ${title}` : `Round ${round.number} of ${title} is open`,
      body: asks[0]?.text ?? null,
      surveyId,
      surveyTitle: gate.survey.title,
    }
  );

  // WhatsApp: template `parlo_new_round` (body: survey_title, round_number;
  // URL button suffix: "<code>?t=<token>"). Sends are fire-and-forget.
  const wa = createWhatsAppClient(c.env.KAPSO_API_KEY, c.env.WHATSAPP_PHONE_NUMBER_ID);
  c.executionCtx.waitUntil(
    (async () => {
      for (const r of recipients) {
        if (!r.phone) continue;
        await wa.sendTemplate(r.phone, "parlo_new_round", [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "survey_title", text: title },
              { type: "text", parameter_name: "round_number", text: String(round.number) },
            ],
          },
          { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: `${gate.survey.code}?t=${r.access_token}` }] },
        ]);
      }
    })()
  );

  trackServerEvent(gate.membership.user_id, "round_approved", { surveyId, round: round.number, kind: round.kind, recipients: recipients.length });
  return c.json({ ok: true, round: { ...(await getRound(c.env.DB, round.id)), asks: await roundAsksWithNames(c.env.DB, round.id) }, notified: recipients.length });
});

// ── Member-facing (personal link) ────────────────────────────────────

/** The agent's report, for members who have answered at least once. */
groups.get("/api/s/:code/report", async (c) => {
  const code = extractCode(c.req.param("code"));
  const survey = await c.env.DB.prepare("SELECT * FROM surveys WHERE code = ? AND status != 'deleted'").bind(code).first<Survey>();
  if (!survey) return c.json({ error: "Parlo not found" }, 404);
  const member = await getMemberByToken(c.env.DB, survey.id, c.req.query("t"));
  if (!member) return c.json({ error: "This link isn't valid for this parlo" }, 403);
  const answered = await c.env.DB.prepare(
    "SELECT 1 FROM responses WHERE survey_id = ? AND user_id = ? AND status != 'in_progress' LIMIT 1"
  )
    .bind(survey.id, member.user_id)
    .first();
  const unlocked = canManage(member.role) || !!answered;
  return c.json({
    available: !!survey.report_md,
    unlocked,
    markdown: unlocked ? survey.report_md ?? null : null,
    updatedAt: survey.report_updated_at ?? null,
    role: member.role,
  });
});

/** Open groups only: what everyone said, with names. */
groups.get("/api/s/:code/feed", async (c) => {
  const code = extractCode(c.req.param("code"));
  const survey = await c.env.DB.prepare("SELECT * FROM surveys WHERE code = ? AND status != 'deleted'").bind(code).first<Survey>();
  if (!survey) return c.json({ error: "Parlo not found" }, 404);
  const member = await getMemberByToken(c.env.DB, survey.id, c.req.query("t"));
  if (!member) return c.json({ error: "This link isn't valid for this parlo" }, 403);
  if (survey.visibility !== "open") return c.json({ error: "This parlo is private" }, 403);

  const rows = await c.env.DB.prepare(
    `SELECT ra.id, ra.question_id, ra.audio_r2_key, ra.image_r2_key, ra.video_r2_key, ra.duration_ms, ra.transcription, ra.transcription_status,
            r.id AS response_id, r.submitted_at, r.user_id, r.first_name AS r_first, r.last_name AS r_last,
            q.text AS question_text, q.question_type, rd.number AS round_number,
            u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.phone
     FROM response_answers ra
     JOIN responses r ON r.id = ra.response_id
     JOIN survey_questions q ON q.id = ra.question_id
     LEFT JOIN rounds rd ON rd.id = q.round_id
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.survey_id = ? AND r.status != 'in_progress' AND r.visibility_at_submit = 'open'
     ORDER BY r.submitted_at DESC LIMIT 200`
  )
    .bind(survey.id)
    .all<{
      id: string; question_id: string; audio_r2_key: string; image_r2_key: string | null; video_r2_key: string | null; duration_ms: number;
      transcription: string | null; transcription_status: string; response_id: string; submitted_at: string | null; user_id: string | null;
      r_first: string | null; r_last: string | null; question_text: string; question_type: string; round_number: number | null;
      first_name: string | null; last_name: string | null; wa_name: string | null; linkedin_name: string | null; phone: string | null;
    }>();

  const baseUrl = new URL(c.req.url).origin;
  const items = await Promise.all(
    rows.results.map(async (r) => {
      const sign = async (key: string | null) => (key ? generatePresignedReadUrl(baseUrl, key, await generateReadToken(c.env.KV, key)) : null);
      return {
        id: r.id,
        responseId: r.response_id,
        userId: r.user_id,
        name: displayNameFor(r) ?? [r.r_first, r.r_last].filter(Boolean).join(" ") ?? "Anonymous",
        submittedAt: r.submitted_at,
        roundNumber: r.round_number ?? 1,
        questionId: r.question_id,
        questionText: r.question_text,
        questionType: r.question_type,
        durationMs: r.duration_ms,
        transcription: r.transcription,
        transcriptionStatus: r.transcription_status,
        audioUrl: await sign(r.audio_r2_key || null),
        imageUrl: await sign(r.image_r2_key),
        videoUrl: await sign(r.video_r2_key),
      };
    })
  );
  return c.json({ items });
});

export default groups;

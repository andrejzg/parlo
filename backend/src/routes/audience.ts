import { Hono } from "hono";
import type { Env } from "../types";

const audience = new Hono<{ Bindings: Env; Variables: { creatorId: string | null } }>();

// ── GET /api/my/surveys/:surveyId/members ── List participants who responded
audience.get("/api/my/surveys/:surveyId/members", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) return c.json({ error: "Authentication required" }, 401);

  const surveyId = c.req.param("surveyId");
  const db = c.env.DB;

  // Verify survey belongs to this creator
  const survey = await db
    .prepare("SELECT id FROM surveys WHERE id = ? AND creator_id = ?")
    .bind(surveyId, creatorId)
    .first();

  if (!survey) {
    return c.json({ error: "Survey not found" }, 404);
  }

  const result = await db
    .prepare(
      `SELECT p.id, p.phone, p.first_name, p.last_name,
              p.linkedin_name, p.linkedin_photo_url, p.linkedin_email,
              sp.responded_at
       FROM participants p
       JOIN survey_participants sp ON sp.participant_id = p.id
       WHERE sp.survey_id = ?
       ORDER BY sp.responded_at DESC`
    )
    .bind(surveyId)
    .all<{
      id: string;
      phone: string | null;
      first_name: string | null;
      last_name: string | null;
      linkedin_name: string | null;
      linkedin_photo_url: string | null;
      linkedin_email: string | null;
      responded_at: string | null;
    }>();

  const members = result.results.map((row) => ({
    id: row.id,
    phone: row.phone,
    firstName: row.first_name,
    lastName: row.last_name,
    linkedinName: row.linkedin_name,
    linkedinPhotoUrl: row.linkedin_photo_url,
    linkedinEmail: row.linkedin_email,
    respondedAt: row.responded_at,
  }));

  return c.json({ members });
});

// ── GET /api/my/notifications ── List notifications for authenticated creator
audience.get("/api/my/notifications", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) return c.json({ error: "Authentication required" }, 401);

  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
  const before = c.req.query("before");

  // Get creator's phone
  const creator = await db
    .prepare("SELECT phone FROM creators WHERE id = ?")
    .bind(creatorId)
    .first<{ phone: string | null }>();

  if (!creator?.phone) {
    return c.json({ notifications: [], unreadCount: 0, hasMore: false });
  }

  // Build query with optional cursor
  let query = `SELECT * FROM notifications WHERE user_phone = ?`;
  const bindings: (string | number)[] = [creator.phone];

  if (before) {
    query += ` AND created_at < ?`;
    bindings.push(before);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  bindings.push(limit);

  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all<{
      id: string;
      user_phone: string;
      type: string;
      title: string;
      body: string | null;
      survey_id: string | null;
      survey_title: string | null;
      read_at: string | null;
      created_at: string;
    }>();

  // Get unread count
  const unreadResult = await db
    .prepare("SELECT COUNT(*) as count FROM notifications WHERE user_phone = ? AND read_at IS NULL")
    .bind(creator.phone)
    .first<{ count: number }>();

  const notifications = result.results.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    surveyId: row.survey_id,
    surveyTitle: row.survey_title,
    read: row.read_at !== null,
    createdAt: row.created_at,
  }));

  return c.json({
    notifications,
    unreadCount: unreadResult?.count ?? 0,
    hasMore: result.results.length === limit,
  });
});

// ── POST /api/my/notifications/read ── Mark notifications as read
audience.post("/api/my/notifications/read", async (c) => {
  const creatorId = c.get("creatorId");
  if (!creatorId) return c.json({ error: "Authentication required" }, 401);

  const db = c.env.DB;
  const body = await c.req.json<{ notificationIds?: string[]; readAll?: boolean }>().catch(() => ({} as { notificationIds?: string[]; readAll?: boolean }));

  // Get creator's phone
  const creator = await db
    .prepare("SELECT phone FROM creators WHERE id = ?")
    .bind(creatorId)
    .first<{ phone: string | null }>();

  if (!creator?.phone) {
    return c.json({ error: "Creator phone not found" }, 404);
  }

  if (body.readAll) {
    await db
      .prepare(
        "UPDATE notifications SET read_at = datetime('now') WHERE user_phone = ? AND read_at IS NULL"
      )
      .bind(creator.phone)
      .run();
  } else if (body.notificationIds?.length) {
    const placeholders = body.notificationIds.map(() => "?").join(", ");
    await db
      .prepare(
        `UPDATE notifications SET read_at = datetime('now')
         WHERE id IN (${placeholders}) AND user_phone = ? AND read_at IS NULL`
      )
      .bind(...body.notificationIds, creator.phone)
      .run();
  } else {
    return c.json({ error: "notificationIds or readAll required" }, 400);
  }

  return c.json({ ok: true });
});

export default audience;

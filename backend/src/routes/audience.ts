import { Hono } from "hono";
import type { Env } from "../types";
import type { AuthVariables } from "../middleware/auth";

/**
 * Inbox notifications for the authenticated user. (Group membership moved
 * to routes/groups.ts.)
 */
const audience = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

async function phoneFor(db: D1Database, userId: string): Promise<string | null> {
  const user = await db.prepare("SELECT phone FROM users WHERE id = ?").bind(userId).first<{ phone: string | null }>();
  return user?.phone ?? null;
}

// ── GET /api/my/notifications ── List notifications for the authenticated user
audience.get("/api/my/notifications", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const db = c.env.DB;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
  const before = c.req.query("before");

  const phone = await phoneFor(db, userId);
  if (!phone) {
    return c.json({ notifications: [], unreadCount: 0, hasMore: false });
  }

  let query = `SELECT * FROM notifications WHERE user_phone = ?`;
  const bindings: (string | number)[] = [phone];

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

  const unreadResult = await db
    .prepare("SELECT COUNT(*) as count FROM notifications WHERE user_phone = ? AND read_at IS NULL")
    .bind(phone)
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
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const db = c.env.DB;
  const body = await c.req.json<{ notificationIds?: string[]; readAll?: boolean }>().catch(() => ({} as { notificationIds?: string[]; readAll?: boolean }));

  const phone = await phoneFor(db, userId);
  if (!phone) {
    return c.json({ error: "No phone on this account" }, 404);
  }

  if (body.readAll) {
    await db
      .prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_phone = ? AND read_at IS NULL")
      .bind(phone)
      .run();
  } else if (body.notificationIds?.length) {
    const placeholders = body.notificationIds.map(() => "?").join(", ");
    await db
      .prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id IN (${placeholders}) AND user_phone = ? AND read_at IS NULL`)
      .bind(...body.notificationIds, phone)
      .run();
  } else {
    return c.json({ error: "notificationIds or readAll required" }, 400);
  }

  return c.json({ ok: true });
});

export default audience;

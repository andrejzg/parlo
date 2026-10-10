/**
 * In-app notifications (the Inbox tab). Rows are keyed by phone because the
 * table predates the users table; helpers here resolve users → phones.
 */

import type { Env } from "../types";
import { generateId } from "./codes";

export type NotificationType =
  | "new_response"
  | "new_round"
  | "round_proposed"
  | "report_ready"
  | "role_changed"
  | "parlo_invite";

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  surveyId?: string | null;
  surveyTitle?: string | null;
}

export async function notifyUsers(db: D1Database, userIds: string[], input: NotificationInput): Promise<number> {
  if (userIds.length === 0) return 0;
  const placeholders = userIds.map(() => "?").join(", ");
  const phones = await db
    .prepare(`SELECT phone FROM users WHERE id IN (${placeholders}) AND phone IS NOT NULL`)
    .bind(...userIds)
    .all<{ phone: string }>();
  if (phones.results.length === 0) return 0;
  await db.batch(
    phones.results.map((p) =>
      db
        .prepare(
          `INSERT INTO notifications (id, user_phone, type, title, body, survey_id, survey_title, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .bind(generateId(), p.phone, input.type, input.title, input.body ?? null, input.surveyId ?? null, input.surveyTitle ?? null)
    )
  );
  return phones.results.length;
}

/** Owner + admins of a parlo. */
export async function managerIds(db: D1Database, surveyId: string): Promise<string[]> {
  const r = await db
    .prepare("SELECT user_id FROM group_members WHERE survey_id = ? AND removed_at IS NULL AND role IN ('owner', 'admin')")
    .bind(surveyId)
    .all<{ user_id: string }>();
  return r.results.map((x) => x.user_id);
}

export async function notifyManagers(env: Env, surveyId: string, input: NotificationInput): Promise<number> {
  return notifyUsers(env.DB, await managerIds(env.DB, surveyId), input);
}

/**
 * Who may do what in a parlo, for route handlers.
 *
 *   member → any active seat (owner, admin, client, participant)
 *   steer  → the research team and the client: read the study, shape the brief
 *   manage → the research team only: send rounds, manage people, spend money
 */

import type { Context } from "hono";
import type { Env, GroupMember, Survey } from "../types";
import type { AuthVariables } from "../middleware/auth";
import { canManage, canSteer, getMembership } from "./groups";

export type SeatLevel = "member" | "steer" | "manage";
export type AppContext = Context<{ Bindings: Env; Variables: AuthVariables }>;
export interface Seat {
  membership: GroupMember;
  survey: Survey;
}

export async function requireSeat(c: AppContext, surveyId: string, level: SeatLevel = "member"): Promise<Seat | Response> {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const survey = await c.env.DB.prepare("SELECT * FROM surveys WHERE id = ? AND status != 'deleted'").bind(surveyId).first<Survey>();
  if (!survey) return c.json({ error: "Parlo not found" }, 404);
  const membership = await getMembership(c.env.DB, surveyId, userId);
  if (!membership) return c.json({ error: "You're not a member of this parlo" }, 403);
  if (level === "manage" && !canManage(membership.role)) return c.json({ error: "Only the research team can do that" }, 403);
  if (level === "steer" && !canSteer(membership.role)) return c.json({ error: "Only the research team and the client can do that" }, 403);
  return { membership, survey };
}

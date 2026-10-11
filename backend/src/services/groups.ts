/**
 * Groups: one identity (`users`), membership with roles (`group_members`),
 * and the permission rules between owner / admin / member.
 *
 * Rules (mirrors WhatsApp, minus its "admins can remove the creator" gap):
 *   - exactly one owner per parlo; `surveys.creator_id` always equals it
 *   - owner can transfer ownership, promote/demote admins, remove anyone
 *   - admins can promote members to admin and remove members, never the
 *     owner or other admins
 *   - answering a parlo makes you a member ("answering is joining");
 *     a removed member stays removed even if they answer again
 */

import type { GroupMember, GroupRole, User } from "../types";
import { generateCode, generateId } from "./codes";
import { legacyNormalizePhone, normalizePhone } from "./phone";

/** Strip leading zeros after the country code: +4407… → +447… */
export { normalizePhone } from "./phone";

/**
 * Find a user by phone. Rows written before 2026-10-11 may carry the form
 * the old normaliser produced (see services/phone.ts); the first lookup
 * that reaches one through its canonical number rewrites it in place.
 */
export async function findUserByPhone(db: D1Database, rawPhone: string): Promise<{ id: string } | null> {
  const phone = normalizePhone(rawPhone);
  const hit = await db.prepare("SELECT id FROM users WHERE phone = ?").bind(phone).first<{ id: string }>();
  if (hit) return hit;
  const legacy = legacyNormalizePhone(phone);
  if (legacy !== phone) {
    const old = await db.prepare("SELECT id FROM users WHERE phone = ?").bind(legacy).first<{ id: string }>();
    if (old) {
      await db.prepare("UPDATE users SET phone = ? WHERE id = ?").bind(phone, old.id).run();
      return old;
    }
  }
  return null;
}

export function displayNameFor(u: Pick<User, "first_name" | "last_name" | "wa_name" | "linkedin_name" | "phone">): string | null {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return full || u.linkedin_name || u.wa_name || null;
}

export function canManage(role: GroupRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Find or create the user for a verified phone. Names are only ever filled
 * in, never overwritten with blanks.
 */
export async function upsertUserByPhone(
  db: D1Database,
  rawPhone: string,
  profile: { firstName?: string | null; lastName?: string | null; waName?: string | null } = {}
): Promise<{ id: string; created: boolean }> {
  const phone = normalizePhone(rawPhone);
  const existing = await findUserByPhone(db, phone);
  if (existing) {
    if (profile.firstName || profile.lastName || profile.waName) {
      await db
        .prepare(
          `UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), wa_name = COALESCE(wa_name, ?) WHERE id = ?`
        )
        .bind(profile.firstName ?? null, profile.lastName ?? null, profile.waName ?? null, existing.id)
        .run();
    }
    return { id: existing.id, created: false };
  }
  const id = generateId();
  await db
    .prepare("INSERT INTO users (id, phone, first_name, last_name, wa_name) VALUES (?, ?, ?, ?, ?)")
    .bind(id, phone, profile.firstName ?? null, profile.lastName ?? null, profile.waName ?? null)
    .run();
  return { id, created: true };
}

export function newAccessToken(): string {
  return generateCode(24);
}

/**
 * Make sure `userId` is a member of the parlo. Existing rows (including
 * removed ones) are left untouched; the current row is returned.
 */
export async function ensureMember(
  db: D1Database,
  surveyId: string,
  userId: string,
  role: GroupRole = "member",
  invitedBy: string | null = null
): Promise<GroupMember & { created: boolean }> {
  const existing = await db
    .prepare("SELECT * FROM group_members WHERE survey_id = ? AND user_id = ?")
    .bind(surveyId, userId)
    .first<GroupMember>();
  if (existing) return { ...existing, created: false };

  const token = newAccessToken();
  await db
    .prepare(
      "INSERT OR IGNORE INTO group_members (survey_id, user_id, role, access_token, invited_by) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(surveyId, userId, role, token, invitedBy)
    .run();
  const row = await db
    .prepare("SELECT * FROM group_members WHERE survey_id = ? AND user_id = ?")
    .bind(surveyId, userId)
    .first<GroupMember>();
  return { ...(row as GroupMember), created: true };
}

/** Active membership (not removed) for a user in a parlo. */
export async function getMembership(db: D1Database, surveyId: string, userId: string | null): Promise<GroupMember | null> {
  if (!userId) return null;
  return db
    .prepare("SELECT * FROM group_members WHERE survey_id = ? AND user_id = ? AND removed_at IS NULL")
    .bind(surveyId, userId)
    .first<GroupMember>();
}

/** Resolve a personal-link token to an active membership. */
export async function getMemberByToken(db: D1Database, surveyId: string, token: string | null | undefined): Promise<GroupMember | null> {
  if (!token || token.length < 8 || token.length > 64) return null;
  return db
    .prepare("SELECT * FROM group_members WHERE survey_id = ? AND access_token = ? AND removed_at IS NULL")
    .bind(surveyId, token)
    .first<GroupMember>();
}

export interface MemberRow {
  userId: string;
  role: GroupRole;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  linkedinName: string | null;
  linkedinPhotoUrl: string | null;
  linkedinEmail: string | null;
  joinedAt: string;
  responseCount: number;
}

export async function listMembers(db: D1Database, surveyId: string): Promise<MemberRow[]> {
  const result = await db
    .prepare(
      `SELECT gm.user_id, gm.role, gm.joined_at,
              u.phone, u.first_name, u.last_name, u.wa_name, u.linkedin_name, u.linkedin_photo_url, u.linkedin_email,
              (SELECT COUNT(*) FROM responses r WHERE r.survey_id = gm.survey_id AND r.user_id = gm.user_id AND r.status != 'in_progress') AS response_count
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.survey_id = ? AND gm.removed_at IS NULL
       ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at ASC`
    )
    .bind(surveyId)
    .all<{
      user_id: string;
      role: GroupRole;
      joined_at: string;
      phone: string | null;
      first_name: string | null;
      last_name: string | null;
      wa_name: string | null;
      linkedin_name: string | null;
      linkedin_photo_url: string | null;
      linkedin_email: string | null;
      response_count: number;
    }>();

  return result.results.map((r) => ({
    userId: r.user_id,
    role: r.role,
    phone: r.phone,
    firstName: r.first_name,
    lastName: r.last_name,
    displayName: displayNameFor(r),
    linkedinName: r.linkedin_name,
    linkedinPhotoUrl: r.linkedin_photo_url,
    linkedinEmail: r.linkedin_email,
    joinedAt: r.joined_at,
    responseCount: r.response_count,
  }));
}

export class GroupPermissionError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 = 403) {
    super(message);
  }
}

/**
 * Change a member's role. Owner can set admin ⇄ member for anyone but
 * themselves; admins can only promote members to admin.
 */
export async function setMemberRole(
  db: D1Database,
  surveyId: string,
  actor: GroupMember,
  targetUserId: string,
  newRole: "admin" | "member"
): Promise<void> {
  if (!canManage(actor.role)) throw new GroupPermissionError("Only the owner or an admin can change roles");
  if (targetUserId === actor.user_id) throw new GroupPermissionError("You can't change your own role", 400);
  const target = await getMembership(db, surveyId, targetUserId);
  if (!target) throw new GroupPermissionError("Member not found", 404);
  if (target.role === "owner") throw new GroupPermissionError("The owner's role can only change by transferring ownership", 400);
  if (actor.role === "admin" && newRole === "member") {
    throw new GroupPermissionError("Only the owner can demote an admin");
  }
  await db
    .prepare("UPDATE group_members SET role = ? WHERE survey_id = ? AND user_id = ?")
    .bind(newRole, surveyId, targetUserId)
    .run();
}

/** Remove a member. Owner can remove anyone but themselves; admins can remove members only. */
export async function removeMember(db: D1Database, surveyId: string, actor: GroupMember, targetUserId: string): Promise<void> {
  if (!canManage(actor.role)) throw new GroupPermissionError("Only the owner or an admin can remove members");
  if (targetUserId === actor.user_id) throw new GroupPermissionError("Transfer ownership before leaving", 400);
  const target = await getMembership(db, surveyId, targetUserId);
  if (!target) throw new GroupPermissionError("Member not found", 404);
  if (target.role === "owner") throw new GroupPermissionError("The owner can't be removed", 400);
  if (actor.role === "admin" && target.role === "admin") throw new GroupPermissionError("Only the owner can remove an admin");
  await db
    .prepare("UPDATE group_members SET removed_at = datetime('now') WHERE survey_id = ? AND user_id = ?")
    .bind(surveyId, targetUserId)
    .run();
}

/** Hand the parlo to another active member. The old owner becomes an admin. */
export async function transferOwnership(db: D1Database, surveyId: string, actor: GroupMember, toUserId: string): Promise<void> {
  if (actor.role !== "owner") throw new GroupPermissionError("Only the owner can transfer ownership");
  if (toUserId === actor.user_id) throw new GroupPermissionError("You already own this parlo", 400);
  const target = await getMembership(db, surveyId, toUserId);
  if (!target) throw new GroupPermissionError("New owner must be a member of this parlo", 404);
  await db.batch([
    db.prepare("UPDATE group_members SET role = 'admin' WHERE survey_id = ? AND user_id = ?").bind(surveyId, actor.user_id),
    db.prepare("UPDATE group_members SET role = 'owner' WHERE survey_id = ? AND user_id = ?").bind(surveyId, toUserId),
    db.prepare("UPDATE surveys SET creator_id = ? WHERE id = ?").bind(toUserId, surveyId),
  ]);
}

/**
 * Attach a verified phone to an anonymous owner. If another user already has
 * that phone, the parlo (and its owner seat) moves to them and the anonymous
 * row is dropped. Returns the final owner id.
 */
export async function claimOwnership(db: D1Database, surveyId: string, anonymousOwnerId: string, rawPhone: string, name?: string | null): Promise<string> {
  const phone = normalizePhone(rawPhone);
  const found = await findUserByPhone(db, phone);
  const existing = found && found.id !== anonymousOwnerId ? found : null;

  if (!existing) {
    await db
      .prepare("UPDATE users SET phone = ?, wa_name = COALESCE(wa_name, ?) WHERE id = ?")
      .bind(phone, name ?? null, anonymousOwnerId)
      .run();
    return anonymousOwnerId;
  }
  return claimOwnershipForUser(db, surveyId, anonymousOwnerId, existing.id);
}

/**
 * Move the owner seat of a parlo from the anonymous user it was created under
 * to a known user (a logged-in device claiming its draft). The anonymous row
 * is dropped if nothing else references it.
 */
export async function claimOwnershipForUser(db: D1Database, surveyId: string, anonymousOwnerId: string, userId: string): Promise<string> {
  if (userId === anonymousOwnerId) return userId;
  const ownerRow = await db
    .prepare("SELECT * FROM group_members WHERE survey_id = ? AND user_id = ?")
    .bind(surveyId, anonymousOwnerId)
    .first<GroupMember>();
  const statements: D1PreparedStatement[] = [
    db.prepare("UPDATE surveys SET creator_id = ? WHERE id = ?").bind(userId, surveyId),
    db.prepare("DELETE FROM group_members WHERE survey_id = ? AND user_id = ?").bind(surveyId, anonymousOwnerId),
    db
      .prepare(
        `INSERT INTO group_members (survey_id, user_id, role, access_token, joined_at)
         VALUES (?, ?, 'owner', ?, datetime('now'))
         ON CONFLICT (survey_id, user_id) DO UPDATE SET role = 'owner', removed_at = NULL`
      )
      .bind(surveyId, userId, ownerRow?.access_token ?? newAccessToken()),
    // Only drop the anonymous row if it has no other parlos.
    db
      .prepare(
        "DELETE FROM users WHERE id = ? AND phone IS NULL AND NOT EXISTS (SELECT 1 FROM surveys WHERE creator_id = ?)"
      )
      .bind(anonymousOwnerId, anonymousOwnerId),
  ];
  await db.batch(statements);
  return userId;
}

/** Every verified user can log in: mint an API key for one that has none. */
export async function ensureApiKey(db: D1Database, userId: string): Promise<string> {
  const row = await db.prepare("SELECT api_key FROM users WHERE id = ?").bind(userId).first<{ api_key: string | null }>();
  if (row?.api_key) return row.api_key;
  const apiKey = `pk_${generateCode(32)}`;
  await db.prepare("UPDATE users SET api_key = ? WHERE id = ? AND api_key IS NULL").bind(apiKey, userId).run();
  const again = await db.prepare("SELECT api_key FROM users WHERE id = ?").bind(userId).first<{ api_key: string | null }>();
  return again?.api_key ?? apiKey;
}

/** Fill in names a member gave us, never overwriting ones we already have. */
export async function updateUserNames(db: D1Database, userId: string, firstName: string | null, lastName: string | null): Promise<void> {
  if (!firstName && !lastName) return;
  await db
    .prepare("UPDATE users SET first_name = COALESCE(first_name, ?), last_name = COALESCE(last_name, ?) WHERE id = ?")
    .bind(firstName, lastName, userId)
    .run();
}

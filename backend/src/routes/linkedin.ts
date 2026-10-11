import { Hono } from "hono";
import type { Env } from "../types";
import type { AuthVariables } from "../middleware/auth";
import { trackServerEvent } from "../services/analytics";

/**
 * LinkedIn connect. Every route that reads or writes a profile identifies the
 * user by API key (`userId`), never by a phone number in the query string: a
 * phone proves nothing and would let anyone read or wipe anyone's profile.
 */
const linkedin = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const SCOPES = "openid profile email";

function apiOrigin(env: Env, requestUrl: string): string {
  return env.API_ORIGIN ?? new URL(requestUrl).origin;
}

function frontendOrigin(env: Env): string {
  return env.FRONTEND_ORIGIN ?? "https://parlo.me";
}

/** Stable, never-expiring URL for a user's photo; streams from R2 via the backend. */
function buildPhotoUrl(env: Env, requestUrl: string, userId: string): string {
  return `${apiOrigin(env, requestUrl)}/api/users/${encodeURIComponent(userId)}/photo`;
}

/**
 * Fetch a LinkedIn profile photo and stash it in R2. LinkedIn's CDN URLs are
 * signed and expire (~30d), which is why we don't link to them directly.
 * Returns the R2 key on success, null if the fetch failed.
 */
async function mirrorPhotoToR2(
  env: Env,
  linkedinSub: string,
  photoUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(photoUrl);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const key = `creators/linkedin/${linkedinSub}.${ext}`;
    await env.AUDIO_BUCKET.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: "public, max-age=86400" },
    });
    return key;
  } catch (err) {
    console.error("[linkedin] Failed to mirror photo to R2:", err);
    return null;
  }
}

/** Only same-origin paths may be used as a post-OAuth destination. */
function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw.slice(0, 200);
}

/**
 * POST /api/auth/linkedin/start  (API key)
 * Body: {returnTo?: "/s/abc123"}
 *
 * Starts the LinkedIn OAuth flow for the authenticated user. Returns the URL
 * the browser should go to; the user id and return path travel in the OAuth
 * `state`, which lives in KV for five minutes.
 */
linkedin.post("/api/auth/linkedin/start", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const body = await c.req.json<{ returnTo?: string }>().catch((): { returnTo?: string } => ({}));
  const returnTo = safeReturnTo(body.returnTo);

  const state = crypto.randomUUID();
  await c.env.KV.put(`linkedin-state:${state}`, JSON.stringify({ userId, returnTo }), { expirationTtl: 300 });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.env.LINKEDIN_CLIENT_ID,
    redirect_uri: `${apiOrigin(c.env, c.req.url)}/api/auth/linkedin/callback`,
    state,
    scope: SCOPES,
  });

  return c.json({ url: `${LINKEDIN_AUTH_URL}?${params.toString()}` });
});

/**
 * GET /api/auth/linkedin/callback?code={code}&state={state}
 *
 * LinkedIn redirects here after the user authorizes. We exchange the code for
 * an access token, fetch their profile via the userinfo endpoint, and store
 * the data on the user record. Then redirect back to the frontend.
 */
linkedin.get("/api/auth/linkedin/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  const home = frontendOrigin(c.env);

  // User denied or error from LinkedIn
  if (error || !code || !state) {
    return c.redirect(`${home}/?linkedin=error`);
  }

  // Validate state and retrieve who started the flow
  const stateData = await c.env.KV.get(`linkedin-state:${state}`);
  if (!stateData) {
    return c.redirect(`${home}/?linkedin=expired`);
  }
  // Delete state token (one-time use)
  await c.env.KV.delete(`linkedin-state:${state}`);

  let userId: string | null = null;
  let returnTo = "/";
  try {
    const parsed = JSON.parse(stateData) as { userId?: string; returnTo?: string };
    userId = parsed.userId ?? null;
    returnTo = safeReturnTo(parsed.returnTo);
  } catch {
    userId = null;
  }
  if (!userId) {
    return c.redirect(`${home}/?linkedin=expired`);
  }

  // Exchange authorization code for access token
  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${apiOrigin(c.env, c.req.url)}/api/auth/linkedin/callback`,
      client_id: c.env.LINKEDIN_CLIENT_ID,
      client_secret: c.env.LINKEDIN_CLIENT_SECRET,
    }),
  });

  if (!tokenRes.ok) {
    console.error("[linkedin] Token exchange failed:", await tokenRes.text());
    return c.redirect(`${home}/?linkedin=error`);
  }

  const tokenData = await tokenRes.json<{ access_token: string }>();

  // Fetch user profile from the OIDC userinfo endpoint
  const profileRes = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!profileRes.ok) {
    console.error("[linkedin] Userinfo failed:", await profileRes.text());
    return c.redirect(`${home}/?linkedin=error`);
  }

  const profile = await profileRes.json<{
    sub: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    email?: string;
    email_verified?: boolean;
    picture?: string;
  }>();

  const displayName =
    profile.name ||
    [profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
    null;

  // Mirror photo bytes to R2 so we don't depend on LinkedIn's expiring URL
  let photoR2Key: string | null = null;
  if (profile.picture) {
    photoR2Key = await mirrorPhotoToR2(c.env, profile.sub, profile.picture);
  }

  const result = await c.env.DB
    .prepare(
      `UPDATE users
       SET linkedin_sub = ?,
           linkedin_name = ?,
           linkedin_email = ?,
           linkedin_photo_url = ?,
           linkedin_photo_r2_key = ?,
           linkedin_connected_at = datetime('now'),
           wa_name = COALESCE(wa_name, ?)
       WHERE id = ?`
    )
    .bind(
      profile.sub,
      displayName,
      profile.email ?? null,
      profile.picture ?? null,
      photoR2Key,
      displayName,
      userId,
    )
    .run();

  if (result.meta.changes === 0) {
    console.error("[linkedin] No user found for id:", userId);
    return c.redirect(`${home}/?linkedin=not_found`);
  }

  trackServerEvent(userId, "linkedin_connected", {
    linkedinSub: profile.sub,
    linkedinName: displayName,
  });

  // Redirect back to frontend with success flag
  const separator = returnTo.includes("?") ? "&" : "?";
  return c.redirect(`${home}${returnTo}${separator}linkedin=connected`);
});

/**
 * GET /api/auth/linkedin/profile  (API key)
 *
 * The authenticated user's LinkedIn profile, if connected.
 */
linkedin.get("/api/auth/linkedin/profile", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);
  const db = c.env.DB;

  const user = await db
    .prepare(
      "SELECT linkedin_sub, linkedin_name, linkedin_email, linkedin_photo_url, linkedin_photo_r2_key, linkedin_connected_at FROM users WHERE id = ?"
    )
    .bind(userId)
    .first<{
      linkedin_sub: string | null;
      linkedin_name: string | null;
      linkedin_email: string | null;
      linkedin_photo_url: string | null;
      linkedin_photo_r2_key: string | null;
      linkedin_connected_at: string | null;
    }>();

  if (!user || !user.linkedin_connected_at) {
    return c.json({ connected: false });
  }

  // Lazy backfill: if we don't yet have an R2 mirror but the LinkedIn URL is
  // still live, mirror it now so it stays usable after LinkedIn's URL expires.
  let r2Key = user.linkedin_photo_r2_key;
  if (!r2Key && user.linkedin_sub && user.linkedin_photo_url) {
    r2Key = await mirrorPhotoToR2(c.env, user.linkedin_sub, user.linkedin_photo_url);
    if (r2Key) {
      await db.prepare("UPDATE users SET linkedin_photo_r2_key = ? WHERE id = ?").bind(r2Key, userId).run();
    }
  }

  return c.json({
    connected: true,
    name: user.linkedin_name,
    email: user.linkedin_email,
    photoUrl: r2Key ? buildPhotoUrl(c.env, c.req.url, userId) : null,
  });
});

/** Stream a mirrored LinkedIn photo from R2 with a long edge cache. */
async function streamPhoto(env: Env, r2Key: string): Promise<Response> {
  const obj = await env.AUDIO_BUCKET.get(r2Key);
  if (!obj) return Response.json({ error: "Photo missing" }, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", "image/jpeg");
  // Long edge cache; CDN-backed via Cloudflare. Re-OAuth overwrites the same
  // R2 key, so a stale cached photo lasts at most a few hours.
  headers.set("cache-control", "public, max-age=3600, s-maxage=86400");
  return new Response(obj.body, { headers });
}

/**
 * GET /api/users/:userId/photo
 *
 * A user's LinkedIn photo by opaque user id — used for the viewer's own
 * profile and for the avatar clusters on the home list. Participants who
 * connected LinkedIn only have the CDN URL on file, so the first request
 * mirrors it into R2; after that it streams from R2.
 */
linkedin.get("/api/users/:userId/photo", async (c) => {
  const userId = c.req.param("userId");
  const user = await c.env.DB
    .prepare("SELECT id, linkedin_sub, linkedin_photo_url, linkedin_photo_r2_key FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string; linkedin_sub: string | null; linkedin_photo_url: string | null; linkedin_photo_r2_key: string | null }>();
  if (!user) return c.json({ error: "Photo not found" }, 404);

  let r2Key = user.linkedin_photo_r2_key;
  if (!r2Key && user.linkedin_photo_url) {
    r2Key = await mirrorPhotoToR2(c.env, user.linkedin_sub ?? user.id, user.linkedin_photo_url);
    if (r2Key) {
      await c.env.DB.prepare("UPDATE users SET linkedin_photo_r2_key = ? WHERE id = ?").bind(r2Key, user.id).run();
    }
  }
  if (!r2Key) return c.json({ error: "Photo not found" }, 404);

  return streamPhoto(c.env, r2Key);
});

/**
 * POST /api/auth/linkedin/disconnect  (API key)
 *
 * Removes the authenticated user's own LinkedIn profile data.
 */
linkedin.post("/api/auth/linkedin/disconnect", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  await c.env.DB
    .prepare(
      `UPDATE users
       SET linkedin_sub = NULL, linkedin_name = NULL, linkedin_email = NULL,
           linkedin_photo_url = NULL, linkedin_photo_r2_key = NULL,
           linkedin_connected_at = NULL
       WHERE id = ?`
    )
    .bind(userId)
    .run();

  trackServerEvent(userId, "linkedin_disconnected", {});
  return c.json({ ok: true });
});

export default linkedin;

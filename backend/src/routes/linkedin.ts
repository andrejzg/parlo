import { Hono } from "hono";
import type { Env } from "../types";
import { trackServerEvent } from "../services/analytics";

const linkedin = new Hono<{ Bindings: Env }>();

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const SCOPES = "openid profile email";

/**
 * GET /api/auth/linkedin/start?phone={phone}
 *
 * Initiates the LinkedIn OAuth flow. The phone param identifies which creator
 * to attach the LinkedIn profile to. We store it in the OAuth state parameter
 * (encrypted via KV with a short TTL) so the callback can look up the creator.
 */
linkedin.get("/api/auth/linkedin/start", async (c) => {
  const phone = c.req.query("phone");
  if (!phone) {
    return c.json({ error: "Phone is required" }, 400);
  }
  // Optional: where to redirect after success (e.g. /s/abc123 for participants)
  const returnTo = c.req.query("returnTo") || "/";

  // Generate a random state token and store phone + returnTo in KV (5-min TTL)
  const state = crypto.randomUUID();
  await c.env.KV.put(`linkedin-state:${state}`, JSON.stringify({ phone, returnTo }), { expirationTtl: 300 });

  const redirectUri = "https://parlo-backend.andrej-c9b.workers.dev/api/auth/linkedin/callback";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: c.env.LINKEDIN_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    scope: SCOPES,
  });

  return c.redirect(`${LINKEDIN_AUTH_URL}?${params.toString()}`);
});

/**
 * GET /api/auth/linkedin/callback?code={code}&state={state}
 *
 * LinkedIn redirects here after the user authorizes. We exchange the code for
 * an access token, fetch their profile via the userinfo endpoint, and store
 * the data on the creator record. Then redirect back to the frontend.
 */
linkedin.get("/api/auth/linkedin/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  // User denied or error from LinkedIn
  if (error || !code || !state) {
    return c.redirect("https://parlo.me/?linkedin=error");
  }

  // Validate state and retrieve the phone + returnTo
  const stateData = await c.env.KV.get(`linkedin-state:${state}`);
  if (!stateData) {
    return c.redirect("https://parlo.me/?linkedin=expired");
  }
  // Delete state token (one-time use)
  await c.env.KV.delete(`linkedin-state:${state}`);

  let phone: string;
  let returnTo = "/";
  try {
    const parsed = JSON.parse(stateData);
    phone = parsed.phone;
    returnTo = parsed.returnTo || "/";
  } catch {
    // Legacy format (plain phone string)
    phone = stateData;
  }

  const redirectUri = "https://parlo-backend.andrej-c9b.workers.dev/api/auth/linkedin/callback";

  // Exchange authorization code for access token
  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: c.env.LINKEDIN_CLIENT_ID,
      client_secret: c.env.LINKEDIN_CLIENT_SECRET,
    }),
  });

  if (!tokenRes.ok) {
    console.error("[linkedin] Token exchange failed:", await tokenRes.text());
    return c.redirect("https://parlo.me/?linkedin=error");
  }

  const tokenData = await tokenRes.json<{ access_token: string }>();

  // Fetch user profile from the OIDC userinfo endpoint
  const profileRes = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!profileRes.ok) {
    console.error("[linkedin] Userinfo failed:", await profileRes.text());
    return c.redirect("https://parlo.me/?linkedin=error");
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

  // Normalize phone for lookup
  const normalizedPhone = phone.replace(/^(\+\d{1,4})0+/, "$1");

  // Update the creator record with LinkedIn data
  const db = c.env.DB;
  const result = await db
    .prepare(
      `UPDATE creators
       SET linkedin_sub = ?,
           linkedin_name = ?,
           linkedin_email = ?,
           linkedin_photo_url = ?,
           linkedin_connected_at = datetime('now'),
           wa_name = COALESCE(wa_name, ?)
       WHERE phone = ?`
    )
    .bind(
      profile.sub,
      displayName,
      profile.email ?? null,
      profile.picture ?? null,
      displayName,
      normalizedPhone,
    )
    .run();

  if (result.meta.changes === 0) {
    console.error("[linkedin] No creator found for phone:", normalizedPhone);
    return c.redirect("https://parlo.me/?linkedin=not_found");
  }

  trackServerEvent(normalizedPhone, "linkedin_connected", {
    linkedinSub: profile.sub,
    linkedinName: displayName,
  });

  // Redirect back to frontend with success flag
  const separator = returnTo.includes("?") ? "&" : "?";
  return c.redirect(`https://parlo.me${returnTo}${separator}linkedin=connected`);
});

/**
 * GET /api/auth/linkedin/profile?phone={phone}
 *
 * Returns the LinkedIn profile data for a creator, if connected.
 * Used by the frontend sidebar to display name + photo.
 */
linkedin.get("/api/auth/linkedin/profile", async (c) => {
  const phone = c.req.query("phone");
  if (!phone) {
    return c.json({ error: "Phone is required" }, 400);
  }

  const normalizedPhone = phone.replace(/^(\+\d{1,4})0+/, "$1");
  const db = c.env.DB;

  const creator = await db
    .prepare(
      "SELECT linkedin_name, linkedin_email, linkedin_photo_url, linkedin_connected_at FROM creators WHERE phone = ?"
    )
    .bind(normalizedPhone)
    .first<{
      linkedin_name: string | null;
      linkedin_email: string | null;
      linkedin_photo_url: string | null;
      linkedin_connected_at: string | null;
    }>();

  if (!creator || !creator.linkedin_connected_at) {
    return c.json({ connected: false });
  }

  return c.json({
    connected: true,
    name: creator.linkedin_name,
    email: creator.linkedin_email,
    photoUrl: creator.linkedin_photo_url,
  });
});

/**
 * POST /api/auth/linkedin/disconnect
 *
 * DEV ONLY — wipes LinkedIn profile data from a creator. Remove before go-live.
 */
linkedin.post("/api/auth/linkedin/disconnect", async (c) => {
  const body = await c.req.json<{ phone: string }>().catch(() => null);
  if (!body?.phone) return c.json({ error: "Phone is required" }, 400);

  const phone = body.phone.replace(/^(\+\d{1,4})0+/, "$1");
  await c.env.DB
    .prepare(
      `UPDATE creators
       SET linkedin_sub = NULL, linkedin_name = NULL, linkedin_email = NULL,
           linkedin_photo_url = NULL, linkedin_connected_at = NULL
       WHERE phone = ?`
    )
    .bind(phone)
    .run();

  return c.json({ ok: true });
});

export default linkedin;

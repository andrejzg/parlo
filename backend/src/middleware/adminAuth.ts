import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

/**
 * Gate for /api/admin/*.
 *
 * parlo.me/admin itself sits behind Cloudflare Access, but the API lives on
 * api.parlo.me where Access cookies don't travel, so the admin page sends a
 * shared secret instead: `X-Parlo-Admin-Key` must equal the Worker secret
 * ADMIN_API_KEY (also in GitHub secrets and backend/.dev.vars). Fails closed
 * if the secret isn't configured.
 */
export const adminAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const expected = c.env.ADMIN_API_KEY;
  if (!expected) {
    return c.json({ error: "Admin API not configured (ADMIN_API_KEY missing)" }, 503);
  }
  const provided = c.req.header("X-Parlo-Admin-Key") ?? "";
  if (!timingSafeEqual(provided, expected)) {
    return c.json({ error: "Admin key required" }, 401);
  }
  await next();
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

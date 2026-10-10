import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export type AuthVariables = { userId: string | null };

type AuthEnv = {
  Bindings: Env;
  Variables: AuthVariables;
};

/**
 * API key auth. Attaches `userId` (the authenticated user's id — a creator,
 * admin or member; one identity table) when a valid key is presented via
 * `X-Parlo-Api-Key` or `Authorization: Bearer pk_...`. Otherwise `userId`
 * is null and the request continues unauthenticated.
 */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  let apiKey: string | null = null;

  const parloHeader = c.req.header("X-Parlo-Api-Key");
  if (parloHeader) {
    apiKey = parloHeader;
  } else {
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer pk_")) {
      apiKey = authHeader.slice(7); // "Bearer " is 7 chars
    }
  }

  if (!apiKey) {
    c.set("userId", null);
    await next();
    return;
  }

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE api_key = ?")
    .bind(apiKey)
    .first<{ id: string }>();

  if (!user) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  c.set("userId", user.id);
  await next();
});

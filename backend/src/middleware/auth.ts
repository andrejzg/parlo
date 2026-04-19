import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

type AuthEnv = {
  Bindings: Env;
  Variables: { creatorId: string | null };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  // Extract API key from X-Parlo-Api-Key header or Authorization: Bearer pk_...
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
    // No auth provided — continue without setting creatorId
    c.set("creatorId", null);
    await next();
    return;
  }

  // Look up creator by api_key
  const creator = await c.env.DB.prepare(
    "SELECT id FROM creators WHERE api_key = ?"
  )
    .bind(apiKey)
    .first<{ id: string }>();

  if (!creator) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  c.set("creatorId", creator.id);
  await next();
});

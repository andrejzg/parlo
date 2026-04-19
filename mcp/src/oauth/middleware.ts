import type { Context, Next } from "hono";
import { OAuthStore } from "./store.js";

type Env = {
  Bindings: {
    OAUTH_KV: KVNamespace;
    PARLO_API_KEY?: string;
  };
  Variables: {
    apiKey: string;
  };
};

export async function bearerAuthMiddleware(c: Context<Env>, next: Next) {
  const authHeader = c.req.header("Authorization");

  // Try Bearer token first
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    const store = new OAuthStore(c.env.OAUTH_KV);
    const storedToken = await store.getAccessToken(token);

    if (storedToken) {
      if (storedToken.expiresAt < Date.now()) {
        return c.json(
          { error: "invalid_token", error_description: "Token has expired" },
          401,
          {
            "WWW-Authenticate": `Bearer resource_metadata="/.well-known/oauth-protected-resource/mcp"`,
          }
        );
      }
      c.set("apiKey", storedToken.apiKey);
      return next();
    }
  }

  // Fall back to PARLO_API_KEY env var for backward compatibility
  if (c.env.PARLO_API_KEY) {
    c.set("apiKey", c.env.PARLO_API_KEY);
    return next();
  }

  // No valid auth found
  return c.json(
    { error: "invalid_token", error_description: "Missing or invalid access token" },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="/.well-known/oauth-protected-resource/mcp"`,
    }
  );
}

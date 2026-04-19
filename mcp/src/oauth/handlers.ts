import { Hono } from "hono";
import { OAuthStore } from "./store.js";
import { verifyCodeChallenge } from "./pkce.js";
import { renderAuthorizePage } from "./authorize-page.js";
import type { StoredClient, StoredAuthCode } from "./types.js";

type Bindings = {
  OAUTH_KV: KVNamespace;
  PARLO_BACKEND: Fetcher;
  PARLO_BACKEND_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// --- Discovery endpoints ---

app.get("/.well-known/oauth-protected-resource/mcp", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
  });
});

app.get("/.well-known/oauth-authorization-server", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  });
});

// --- Dynamic Client Registration ---

app.post("/register", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const redirectUris: string[] = body.redirect_uris;
  if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return c.json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" }, 400);
  }

  const store = new OAuthStore(c.env.OAUTH_KV);
  const clientId = store.generateToken(24);
  const clientSecret = store.generateToken(32);

  const client: StoredClient = {
    clientId,
    clientSecret,
    redirectUris,
    clientName: body.client_name || undefined,
    grantTypes: body.grant_types || ["authorization_code", "refresh_token"],
    responseTypes: body.response_types || ["code"],
    createdAt: Date.now(),
  };

  await store.saveClient(client);

  return c.json(
    {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uris: client.redirectUris,
      client_name: client.clientName,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
    },
    201
  );
});

// --- Authorization ---

app.get("/authorize", async (c) => {
  const {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state,
  } = c.req.query();

  if (!clientId || !redirectUri || !codeChallenge || !state) {
    return c.json({ error: "invalid_request", error_description: "Missing required parameters" }, 400);
  }
  if (responseType !== "code") {
    return c.json({ error: "unsupported_response_type" }, 400);
  }
  if (codeChallengeMethod !== "S256") {
    return c.json({ error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" }, 400);
  }

  const store = new OAuthStore(c.env.OAUTH_KV);
  const client = await store.getClient(clientId);
  if (!client) {
    return c.json({ error: "invalid_client", error_description: "Unknown client_id" }, 400);
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return c.json({ error: "invalid_request", error_description: "redirect_uri not registered" }, 400);
  }

  const html = renderAuthorizePage({
    clientName: client.clientName,
    clientId,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod,
  });

  return c.html(html);
});

app.post("/authorize", async (c) => {
  const form = await c.req.formData();
  const action = form.get("action") as string;
  const apiKeyInput = (form.get("api_key") as string || "").trim();
  const clientId = form.get("client_id") as string;
  const redirectUri = form.get("redirect_uri") as string;
  const state = form.get("state") as string;
  const codeChallenge = form.get("code_challenge") as string;
  const codeChallengeMethod = form.get("code_challenge_method") as string;

  if (!clientId || !redirectUri || !state || !codeChallenge || !codeChallengeMethod) {
    return c.json({ error: "invalid_request", error_description: "Missing required parameters" }, 400);
  }

  const store = new OAuthStore(c.env.OAUTH_KV);
  const client = await store.getClient(clientId);
  if (!client) {
    return c.json({ error: "invalid_client" }, 400);
  }

  const showError = (error: string) => {
    const html = renderAuthorizePage({
      clientName: client.clientName,
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      error,
    });
    return c.html(html);
  };

  let apiKey: string;

  if (action === "create_new") {
    // Create a new creator via the backend
    const backendUrl = `${c.env.PARLO_BACKEND_URL}/api/surveys`;
    const res = await c.env.PARLO_BACKEND.fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      return showError("Failed to create account. Please try again.");
    }
    const data = (await res.json()) as { apiKey?: string };
    if (!data.apiKey) {
      return showError("Failed to create account. No API key returned.");
    }
    apiKey = data.apiKey;
  } else {
    // Validate the provided API key
    if (!apiKeyInput || !apiKeyInput.startsWith("pk_")) {
      return showError("Please enter a valid API key starting with pk_");
    }
    const backendUrl = `${c.env.PARLO_BACKEND_URL}/api/my/surveys`;
    const res = await c.env.PARLO_BACKEND.fetch(backendUrl, {
      headers: { "X-Parlo-Api-Key": apiKeyInput },
    });
    if (res.status === 401) {
      return showError("Invalid API key. Please check and try again.");
    }
    if (!res.ok) {
      return showError("Failed to verify API key. Please try again.");
    }
    apiKey = apiKeyInput;
  }

  // Generate auth code and redirect
  const code = store.generateToken(32);
  const authCode: StoredAuthCode = {
    code,
    apiKey,
    clientId,
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  await store.saveAuthCode(authCode);

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", state);

  return c.redirect(redirectUrl.toString(), 302);
});

// --- Token Exchange ---

app.post("/token", async (c) => {
  const body = await c.req.parseBody();
  const grantType = body.grant_type as string;
  const store = new OAuthStore(c.env.OAUTH_KV);

  if (grantType === "authorization_code") {
    const code = body.code as string;
    const redirectUri = body.redirect_uri as string;
    const clientId = body.client_id as string;
    const codeVerifier = body.code_verifier as string;

    if (!code || !clientId || !codeVerifier) {
      return c.json({ error: "invalid_request", error_description: "Missing required parameters" }, 400);
    }

    const authCode = await store.getAuthCode(code);
    if (!authCode) {
      return c.json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" }, 400);
    }

    // Validate
    if (authCode.clientId !== clientId) {
      return c.json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
    }
    if (redirectUri && authCode.redirectUri !== redirectUri) {
      return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
    }

    // Verify PKCE
    const valid = await verifyCodeChallenge(codeVerifier, authCode.codeChallenge);
    if (!valid) {
      return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }

    // Consume the auth code
    await store.deleteAuthCode(code);

    // Issue tokens
    const accessToken = store.generateToken(48);
    const refreshToken = store.generateToken(48);

    await store.saveAccessToken(accessToken, {
      apiKey: authCode.apiKey,
      clientId,
      expiresAt: Date.now() + 3600 * 1000,
    });

    await store.saveRefreshToken(refreshToken, {
      apiKey: authCode.apiKey,
      clientId,
      createdAt: Date.now(),
    });

    return c.json({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
    });
  }

  if (grantType === "refresh_token") {
    const refreshTokenValue = body.refresh_token as string;
    const clientId = body.client_id as string;

    if (!refreshTokenValue || !clientId) {
      return c.json({ error: "invalid_request", error_description: "Missing required parameters" }, 400);
    }

    const storedRefresh = await store.getRefreshToken(refreshTokenValue);
    if (!storedRefresh) {
      return c.json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" }, 400);
    }

    if (storedRefresh.clientId !== clientId) {
      return c.json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
    }

    // Issue new access token
    const accessToken = store.generateToken(48);

    await store.saveAccessToken(accessToken, {
      apiKey: storedRefresh.apiKey,
      clientId,
      expiresAt: Date.now() + 3600 * 1000,
    });

    return c.json({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: refreshTokenValue,
    });
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
});

export { app as oauthHandlers };

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { initAnalytics, captureServerException } from "./services/analytics";
import { authMiddleware } from "./middleware/auth";

import surveys from "./routes/surveys";
import responses from "./routes/responses";
import webhooks from "./routes/webhooks";
import dashboard from "./routes/dashboard";
import upload from "./routes/upload";
import admin from "./routes/admin";
import otp from "./routes/otp";
import og from "./routes/og";
import linkedin from "./routes/linkedin";
import feed from "./routes/feed";
import audience from "./routes/audience";

const app = new Hono<{ Bindings: Env; Variables: { creatorId: string | null } }>();

// ── Middleware ──
app.use("*", cors({
  origin: ["https://parlo.me", "http://localhost:5173", "http://localhost:4173"],
}));

// Initialise PostHog analytics on every request (idempotent, pulls key from env)
app.use("*", async (c, next) => {
  initAnalytics(c.env.POSTHOG_API_KEY);
  await next();
});

// API key auth — attaches creatorId to context if valid key provided
app.use("*", authMiddleware);

// ── Health check ──
app.get("/", (c) => c.json({ status: "ok", service: "parlo-backend" }));

// ── Routes ──
app.route("/", surveys);
app.route("/", responses);
app.route("/", webhooks);
app.route("/", dashboard);
app.route("/", upload);
app.route("/", admin);
app.route("/", otp);
app.route("/", og);
app.route("/", linkedin);
app.route("/", feed);
app.route("/", audience);

// ── Error handler — forward unhandled exceptions to PostHog ──
app.onError((err, c) => {
  const distinctId = c.get("creatorId") ?? "anonymous";
  const promise = captureServerException(distinctId, err, {
    path: c.req.path,
    method: c.req.method,
  });
  if (promise) c.executionCtx.waitUntil(promise);
  console.error("[onError]", c.req.method, c.req.path, err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;

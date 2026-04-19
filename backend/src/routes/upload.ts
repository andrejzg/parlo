import { Hono } from "hono";
import type { Env } from "../types";
import {
  uploadToR2,
  getFromR2,
  validateUploadToken,
  validateReadToken,
} from "../services/r2";
import { checkRateLimit } from "../services/ratelimit";

const upload = new Hono<{ Bindings: Env }>();

// ── PUT /api/upload/:key?token=xxx ── Proxy upload to R2 (authenticated)
upload.put("/api/upload/:key", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const token = c.req.query("token");

  // Require upload token
  if (!token) {
    return c.json({ error: "Missing upload token" }, 401);
  }

  // Validate one-time upload token
  const valid = await validateUploadToken(c.env.KV, key, token);
  if (!valid) {
    return c.json({ error: "Invalid or expired upload token" }, 403);
  }

  // Rate limit: 20 uploads per IP per hour
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const allowed = await checkRateLimit(c.env.KV, "upload", ip, 20);
  if (!allowed) {
    return c.json({ error: "Upload rate limit exceeded" }, 429);
  }

  // Accept content-type from client, default to audio/webm
  const contentType = c.req.header("content-type") ?? "audio/webm";
  const body = await c.req.arrayBuffer();

  await uploadToR2(c.env.AUDIO_BUCKET, key, body, contentType);

  return c.json({ success: true, key }, 201);
});

// ── GET /api/audio/:key?token=xxx ── Proxy read from R2 (authenticated)
upload.get("/api/audio/:key", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const token = c.req.query("token");

  // Require read token
  if (!token) {
    return c.json({ error: "Missing read token" }, 401);
  }

  // Validate read token
  const valid = await validateReadToken(c.env.KV, key, token);
  if (!valid) {
    return c.json({ error: "Invalid or expired read token" }, 403);
  }

  const object = await getFromR2(c.env.AUDIO_BUCKET, key);

  if (!object) {
    return c.json({ error: "Audio not found" }, 404);
  }

  const headers = new Headers();
  headers.set(
    "content-type",
    object.httpMetadata?.contentType ?? "audio/webm"
  );
  headers.set("cache-control", "public, max-age=3600");

  return new Response(object.body, { headers });
});

export default upload;

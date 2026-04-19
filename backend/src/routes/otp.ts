import { Hono } from "hono";
import type { Env } from "../types";
import { createWhatsAppClient } from "../services/whatsapp";
import { checkRateLimit } from "../services/ratelimit";
import { trackServerEvent } from "../services/analytics";

const otp = new Hono<{ Bindings: Env }>();

function generateOtpCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

// ── POST /api/otp/send-whatsapp ── Send OTP via WhatsApp
otp.post("/api/otp/send-whatsapp", async (c) => {
  const body = await c.req.json<{ phone?: string }>().catch(() => ({}) as { phone?: string });
  const phone = body.phone;

  if (!phone) {
    return c.json({ error: "Phone number required" }, 400);
  }

  // Rate limit: 5 OTPs per phone per hour
  const allowed = await checkRateLimit(c.env.KV, "otp-send", phone, 5);
  if (!allowed) {
    return c.json({ error: "Too many OTP requests. Try again later." }, 429);
  }

  const code = generateOtpCode();

  // Store in KV with 5-minute TTL
  await c.env.KV.put(`otp:${phone}`, code, { expirationTtl: 300 });

  // Send via WhatsApp
  const wa = createWhatsAppClient(c.env.KAPSO_API_KEY, c.env.WHATSAPP_PHONE_NUMBER_ID);
  await wa.sendText(phone, `Your Parlo verification code is: ${code}\n\nThis code expires in 5 minutes.`);

  trackServerEvent(phone, "otp_sent", { channel: "whatsapp" });

  return c.json({ sent: true });
});

// ── POST /api/otp/verify-whatsapp ── Verify WhatsApp OTP
otp.post("/api/otp/verify-whatsapp", async (c) => {
  const body = await c.req
    .json<{ phone?: string; code?: string }>()
    .catch(() => ({}) as { phone?: string; code?: string });
  const { phone, code } = body;

  if (!phone || !code) {
    return c.json({ error: "Phone and code required" }, 400);
  }

  const stored = await c.env.KV.get(`otp:${phone}`);

  if (!stored || stored !== code) {
    trackServerEvent(phone, "otp_verify_failed", { channel: "whatsapp" });
    return c.json({ verified: false });
  }

  // Delete code after successful verification (one-time use)
  await c.env.KV.delete(`otp:${phone}`);

  trackServerEvent(phone, "otp_verified", { channel: "whatsapp" });

  return c.json({ verified: true });
});

export default otp;

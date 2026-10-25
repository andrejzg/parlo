import { Hono } from "hono";
import type { Env, WhatsAppWebhookPayload, Survey } from "../types";
import { createWhatsAppClient, downloadInboundMedia } from "../services/whatsapp";
import { trackServerEvent } from "../services/analytics";
import { openerTokenKey, storeIntroBytes } from "../services/intro";
import { claimOwnership, normalizePhone } from "../services/groups";
import { buildShareUrl } from "../services/slug";

type InboundMedia = { url: string | null; id: string | null; contentType: string | null };
type Inbound = { kind: "text" | "audio"; text: string; from: string; contactName: string | null; media: InboundMedia | null };

/** Flatten one Kapso-v2 / Meta message object into what the handlers need. */
function toInbound(msg: any, contactName: string | null): Inbound | null {
  if (!msg || typeof msg !== "object") return null;
  if (msg.type === "text" && msg.text?.body) {
    return { kind: "text", text: String(msg.text.body).trim(), from: msg.from ?? "", contactName, media: null };
  }
  if (msg.type === "audio") {
    const k = msg.kapso ?? {};
    return {
      kind: "audio",
      text: "",
      from: msg.from ?? "",
      contactName: contactName ?? k.contact_name ?? null,
      media: {
        url: k.media_url ?? k.media_data?.url ?? null,
        id: msg.audio?.id ?? null,
        contentType: k.media_data?.content_type ?? msg.audio?.mime_type ?? null,
      },
    };
  }
  return null;
}

/** A WhatsApp `from` is digits without the plus; our users carry E.164. */
function phoneFromWa(from: string): string {
  return normalizePhone(from.startsWith("+") ? from : `+${from}`);
}

// Ten minutes: long enough to record, short enough that a stale binding
// cannot catch a voice note meant for another parlo (seen 2026-10-25).
const OPENER_SESSION_TTL_SECONDS = 600;
function openerSessionKey(from: string) {
  return `wa-opener:${from}`;
}

const webhooks = new Hono<{ Bindings: Env }>();

async function isValidKapsoSignature(secret: string, body: string, signature: string | undefined): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = signature.trim().toLowerCase().replace(/^sha256=/, "");
  if (given.length !== expected.length) return false;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// ── POST /api/webhooks/whatsapp ── Handle incoming WhatsApp messages
webhooks.post("/api/webhooks/whatsapp", async (c) => {
  // Kapso signs each delivery: X-Webhook-Signature = hex HMAC-SHA256(secret, raw body).
  // Reject unsigned or forged calls so nobody else can trigger sends from our number.
  const body = await c.req.text();
  if (!c.env.KAPSO_WEBHOOK_SECRET) {
    console.error("[webhook] KAPSO_WEBHOOK_SECRET is not set; rejecting delivery");
    return c.json({ error: "webhook secret not configured" }, 500);
  }
  if (!(await isValidKapsoSignature(c.env.KAPSO_WEBHOOK_SECRET, body, c.req.header("x-webhook-signature")))) {
    console.warn("[webhook] invalid signature; rejecting delivery");
    return c.json({ error: "invalid signature" }, 401);
  }
  const raw = JSON.parse(body);
  const db = c.env.DB;
  const wa = createWhatsAppClient(c.env.KAPSO_API_KEY, c.env.WHATSAPP_PHONE_NUMBER_ID);

  // Log the raw payload for debugging
  console.log("[webhook] raw payload:", JSON.stringify(raw).slice(0, 2000));

  // Normalize Kapso v2 payload or Meta raw payload into a flat message list
  const incomingMessages: Inbound[] = [];

  // Check for X-Webhook-Event header (Kapso v2 format)
  const webhookEvent = c.req.header("x-webhook-event");

  if (webhookEvent === "whatsapp.message.received" || raw.message) {
    // Kapso v2 format — message is at top level
    const one = toInbound(raw.message, raw.message?.kapso?.contact_name ?? null);
    if (one) incomingMessages.push(one);
  } else if (Array.isArray(raw)) {
    // Kapso v2 buffered format — array of events
    for (const item of raw) {
      const one = toInbound(item.message, item.message?.kapso?.contact_name ?? null);
      if (one) incomingMessages.push(one);
    }
  } else if (raw.entry) {
    // Meta raw webhook format
    for (const entry of raw.entry) {
      for (const change of entry.changes ?? []) {
        const messages = change.value.messages ?? [];
        const contacts = change.value.contacts ?? [];
        for (const msg of messages) {
          const one = toInbound(msg, contacts.find((ct: any) => ct.wa_id === msg.from)?.profile?.name ?? null);
          if (one) incomingMessages.push(one);
        }
      }
    }
  }

  console.log(`[webhook] parsed ${incomingMessages.length} messages:`, JSON.stringify(incomingMessages));

  for (const { kind, text, from, contactName, media } of incomingMessages) {
    console.log(`[webhook] processing ${kind} from=${from} text="${text}"`);

    // ── "opener <code> <token>": the deep link an agent (or the create answer) hands the owner.
    // Binds this number to the parlo for an hour; the next voice note becomes the opener.
    const openerMatch = kind === "text" ? text.match(/^opener\s+([a-z0-9]{6,12})\s+([a-z0-9]{16,40})\s*$/i) : null;
    if (openerMatch) {
      const [, code, token] = openerMatch;
      const surveyId = await c.env.KV.get(openerTokenKey(token));
      const survey = surveyId
        ? await db.prepare("SELECT s.id, s.code, s.title, s.creator_id, u.phone AS owner_phone FROM surveys s JOIN users u ON u.id = s.creator_id WHERE s.id = ?").bind(surveyId).first<{ id: string; code: string; title: string | null; creator_id: string; owner_phone: string | null }>()
        : null;
      trackServerEvent(from, "whatsapp_opener_link_opened", { ok: !!survey && survey.code === code });
      if (!survey || survey.code.toLowerCase() !== code.toLowerCase()) {
        await wa.sendText(from, "That opener link has expired. Ask your agent for a fresh one, or open the parlo's dashboard to record it there.");
        continue;
      }
      const senderPhone = phoneFromWa(from);
      if (survey.owner_phone && survey.owner_phone !== senderPhone) {
        await wa.sendText(from, "This parlo belongs to someone else, so I can't take its opener from this number.");
        continue;
      }
      await c.env.KV.put(openerSessionKey(from), JSON.stringify({ surveyId: survey.id, token }), { expirationTtl: OPENER_SESSION_TTL_SECONDS });
      await wa.sendText(
        from,
        `Hi! Send me a voice note now for "${survey.title ?? "your parlo"}", 30 to 60 seconds, as if you were talking to the group: who you are, what you want to hear from them, and what you'll do with it. They'll hear it before they answer.`
      );
      continue;
    }

    // ── A voice note: the opener, if this number asked to send one in the last hour.
    if (kind === "audio") {
      const sessionRaw = await c.env.KV.get(openerSessionKey(from));
      if (!sessionRaw) {
        await wa.sendText(from, "Thanks for the voice note! To add it as a parlo's opener, tap the opener link your agent sent you first (it starts with \"opener\"), then send the voice note again.");
        continue;
      }
      const session = JSON.parse(sessionRaw) as { surveyId: string; token: string };
      const survey = await db
        .prepare("SELECT s.id, s.code, s.title, s.dashboard_code, s.creator_id, u.phone AS owner_phone FROM surveys s JOIN users u ON u.id = s.creator_id WHERE s.id = ?")
        .bind(session.surveyId)
        .first<{ id: string; code: string; title: string | null; dashboard_code: string; creator_id: string; owner_phone: string | null }>();
      if (!survey) {
        await c.env.KV.delete(openerSessionKey(from));
        await wa.sendText(from, "That parlo is gone. Ask your agent for a fresh opener link.");
        continue;
      }
      const senderPhone = phoneFromWa(from);
      if (survey.owner_phone && survey.owner_phone !== senderPhone) {
        await wa.sendText(from, "This parlo belongs to someone else, so I can't take its opener from this number.");
        continue;
      }
      try {
        const got = await downloadInboundMedia(c.env.KAPSO_API_KEY, c.env.WHATSAPP_PHONE_NUMBER_ID, media ?? {});
        const saved = await storeIntroBytes(c.env, survey.id, got.bytes, got.contentType, "whatsapp");
        // The number is proof (Meta delivered the message from it): an anonymous
        // owner seat becomes this person's, with no OTP.
        let claimed = false;
        if (!survey.owner_phone) {
          await claimOwnership(db, survey.id, survey.creator_id, senderPhone, contactName);
          claimed = true;
        }
        await Promise.all([c.env.KV.delete(openerSessionKey(from)), c.env.KV.delete(openerTokenKey(session.token))]);
        trackServerEvent(from, "whatsapp_opener_saved", { surveyId: survey.id, durationMs: saved.durationMs, bytes: saved.bytes, claimed });
        const shareLink = buildShareUrl(survey.title, survey.code);
        const heard = saved.transcript ? `I heard: "${saved.transcript.slice(0, 160)}${saved.transcript.length > 160 ? "…" : ""}"` : "Saved.";
        await wa.sendText(
          from,
          `Opener saved for "${survey.title ?? "your parlo"}". ${heard}\n\nThe group hears it before they answer. Share: ${shareLink}\n\n${claimed ? "This parlo is now yours: " : "Your dashboard: "}https://parlo.me/d/${survey.dashboard_code}`
        );
      } catch (err) {
        console.error("[webhook] opener voice note failed", { from, surveyId: survey.id, err });
        trackServerEvent(from, "whatsapp_opener_failed", { surveyId: survey.id, error: err instanceof Error ? err.message : String(err) });
        await wa.sendText(from, "I couldn't take that voice note. Could you send it once more?");
      }
      continue;
    }

        // Check response pattern FIRST (message may contain both "survey" and "response")
        // Prefilled message: "Parlo - survey response submitted for <code>"
        const isResponsePattern = /response\s+submitted\s+for\s+(\S+)/i.test(text) || /response\s+(\S+)/i.test(text);
        const isSurveyPattern = !isResponsePattern && (/notify\s+me\s+about\s+(?:survey|parlo)\s+\S+/i.test(text) || /\b(?:survey|parlo)\s+[a-z0-9]{6,12}\b/i.test(text));
        const messageType = isResponsePattern ? "response" : isSurveyPattern ? "survey" : "unknown";
        trackServerEvent(from, "whatsapp_message_received", { messageType, from });

        // RESPONSE pattern checked FIRST (message may contain both "survey" and "response")
        // Prefilled: "Parlo - survey response submitted for <code>"
        // Also accept the bare "response <code>" that ThankYouScreen prefills.
        const responseMatch =
          text.match(/response\s+submitted\s+for\s+(\S+)/i) ||
          text.match(/submitted\s+.*?response\s+(\S+)/i) ||
          text.match(/^response\s+(\S+)$/i);
        if (responseMatch) {
          const code = responseMatch[1];
          const response = await db
            .prepare(`
              SELECT r.*, s.creator_id, s.title, s.visibility, s.code as survey_code, s.dashboard_code
              FROM responses r
              JOIN surveys s ON r.survey_id = s.id
              WHERE r.code = ?
            `)
            .bind(code)
            .first<any>();

          if (response) {
            // Mark response as notified
            await db
              .prepare("UPDATE responses SET status = 'notified' WHERE id = ?")
              .bind(response.id)
              .run();

            // Reply to participant based on survey visibility
            const participantName = response.first_name ?? "there";
            if (response.visibility === "open") {
              await wa.sendTemplate(from, "parlo_thanks_open", [
                { type: "body", parameters: [{ type: "text", parameter_name: "name", text: participantName }] },
                { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: response.survey_code }] },
              ]);
            } else {
              await wa.sendTemplate(from, "parlo_thanks", [
                { type: "body", parameters: [{ type: "text", parameter_name: "name", text: participantName }] },
              ]);
            }

            // Notify creator if they have a phone number
            const creator = await db
              .prepare("SELECT phone, wa_name FROM users WHERE id = ?")
              .bind(response.creator_id)
              .first<{ phone: string | null; wa_name: string | null }>();

            if (creator?.phone) {
              const responseCount = await db
                .prepare("SELECT COUNT(*) as count FROM responses WHERE survey_id = ? AND status IN ('submitted', 'notified')")
                .bind(response.survey_id)
                .first<{ count: number }>();

              trackServerEvent(creator.phone, "creator_notification_sent", {
                surveyId: response.survey_id,
                respondentName: response.first_name ?? "Someone",
                responseCount: responseCount?.count ?? 1,
              });

              await wa.sendTemplate(creator.phone, "parlo_new_response", [
                {
                  type: "body",
                  parameters: [
                    { type: "text", parameter_name: "respondent", text: response.first_name ?? "Someone" },
                    { type: "text", parameter_name: "survey_title", text: response.title ?? "your survey" },
                    { type: "text", parameter_name: "response_count", text: String(responseCount?.count ?? 1) },
                  ],
                },
                { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: response.dashboard_code }] },
              ]);
            }
          } else {
            await wa.sendText(from, `Thanks for reaching out! No response found with that code.`);
          }
          continue;
        }

        // SURVEY pattern: "notify me about parlo <code>" (the prefilled share-screen message; "survey" still accepted) or "parlo <code>"
        const notifyMatch = text.match(/notify\s+me\s+about\s+(?:survey|parlo)\s+(\S+)/i) || text.match(/\b(?:survey|parlo)\s+([a-z0-9]{6,12})\b/i);
        if (notifyMatch) {
          const code = notifyMatch[1];
          // Skip if code looks like "response" (already handled above)
          if (code.toLowerCase() === "response") {
            // fall through to fallback
          } else {
            const survey = await db
              .prepare("SELECT * FROM surveys WHERE code = ?")
              .bind(code)
              .first<Survey>();

            if (survey) {
              await db
                .prepare("UPDATE users SET phone = COALESCE(phone, ?), wa_name = COALESCE(wa_name, ?) WHERE id = ?")
                .bind(from, contactName, survey.creator_id)
                .run();

              trackServerEvent(from, "$identify", {
                $set: { phone: from, wa_name: contactName, role: "creator" },
              });

              await wa.sendTemplate(from, "parlo_survey_ready", [
                { type: "body", parameters: [{ type: "text", parameter_name: "share_url", text: `https://parlo.me/s/${code}` }] },
                { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: code }] },
              ]);
            } else {
              await wa.sendText(from, `No parlo found with code "${code}". Check the code and try again.`);
            }
            continue;
          }
        }

    // Unrecognized message — friendly fallback
    console.log(`[webhook] sending fallback to ${from}`);
    try {
      await wa.sendText(
        from,
        "Hey! I'm Parlo. Visit parlo.me to create a parlo, or paste a code if you have one!"
      );
      console.log(`[webhook] fallback sent successfully`);
    } catch (err) {
      console.error(`[webhook] fallback send error:`, err);
    }
  }

  // Always return 200 to WhatsApp
  return c.json({ status: "ok" });
});

// ── GET /api/webhooks/whatsapp ── Webhook verification
webhooks.get("/api/webhooks/whatsapp", async (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === c.env.WHATSAPP_VERIFY_TOKEN) {
    return c.text(challenge ?? "", 200);
  }

  return c.text("Forbidden", 403);
});

export default webhooks;

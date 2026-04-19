import { Hono } from "hono";
import type { Env, WhatsAppWebhookPayload, Survey } from "../types";
import { createWhatsAppClient } from "../services/whatsapp";
import { trackServerEvent } from "../services/analytics";

const webhooks = new Hono<{ Bindings: Env }>();

// ── POST /api/webhooks/whatsapp ── Handle incoming WhatsApp messages
webhooks.post("/api/webhooks/whatsapp", async (c) => {
  const raw = await c.req.json<any>();
  const db = c.env.DB;
  const wa = createWhatsAppClient(c.env.KAPSO_API_KEY, c.env.WHATSAPP_PHONE_NUMBER_ID);

  // Log the raw payload for debugging
  console.log("[webhook] raw payload:", JSON.stringify(raw).slice(0, 2000));

  // Normalize Kapso v2 payload or Meta raw payload into a flat message list
  let incomingMessages: { text: string; from: string; contactName: string | null }[] = [];

  // Check for X-Webhook-Event header (Kapso v2 format)
  const webhookEvent = c.req.header("x-webhook-event");

  if (webhookEvent === "whatsapp.message.received" || raw.message) {
    // Kapso v2 format — message is at top level
    const msg = raw.message;
    if (msg && msg.type === "text" && msg.text?.body) {
      incomingMessages.push({
        text: msg.text.body.trim(),
        from: msg.from ?? "",
        contactName: raw.conversation?.phone_number ?? msg.kapso?.contact_name ?? null,
      });
    }
  } else if (Array.isArray(raw)) {
    // Kapso v2 buffered format — array of events
    for (const item of raw) {
      const msg = item.message;
      if (msg && msg.type === "text" && msg.text?.body) {
        incomingMessages.push({
          text: msg.text.body.trim(),
          from: msg.from ?? "",
          contactName: item.conversation?.phone_number ?? null,
        });
      }
    }
  } else if (raw.entry) {
    // Meta raw webhook format
    for (const entry of raw.entry) {
      for (const change of entry.changes ?? []) {
        const messages = change.value.messages ?? [];
        const contacts = change.value.contacts ?? [];
        for (const msg of messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;
          incomingMessages.push({
            text: msg.text.body.trim(),
            from: msg.from,
            contactName: contacts.find((ct: any) => ct.wa_id === msg.from)?.profile?.name ?? null,
          });
        }
      }
    }
  }

  console.log(`[webhook] parsed ${incomingMessages.length} messages:`, JSON.stringify(incomingMessages));

  for (const { text, from, contactName } of incomingMessages) {
    console.log(`[webhook] processing message from=${from} text="${text}"`);

        // Check response pattern FIRST (message may contain both "survey" and "response")
        // Prefilled message: "Parlo - survey response submitted for <code>"
        const isResponsePattern = /response\s+submitted\s+for\s+(\S+)/i.test(text) || /response\s+(\S+)/i.test(text);
        const isSurveyPattern = !isResponsePattern && (/notify\s+me\s+about\s+survey\s+\S+/i.test(text) || /survey\s+(\S+)/i.test(text));
        const messageType = isResponsePattern ? "response" : isSurveyPattern ? "survey" : "unknown";
        trackServerEvent(from, "whatsapp_message_received", { messageType, from });

        // RESPONSE pattern checked FIRST (message may contain both "survey" and "response")
        // Prefilled: "Parlo - survey response submitted for <code>"
        const responseMatch = text.match(/response\s+submitted\s+for\s+(\S+)/i) || text.match(/submitted\s+.*?response\s+(\S+)/i);
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
            if (response.visibility === "open") {
              await wa.sendTemplate(from, "parlo_thanks_open", [
                { type: "body", parameters: [{ type: "text", text: contactName ?? "The creator" }] },
                { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: response.survey_code }] },
              ]);
            } else {
              await wa.sendTemplate(from, "parlo_thanks", [
                { type: "body", parameters: [{ type: "text", text: contactName ?? "The creator" }] },
              ]);
            }

            // Notify creator if they have a phone number
            const creator = await db
              .prepare("SELECT phone, wa_name FROM creators WHERE id = ?")
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
                    { type: "text", text: response.first_name ?? "Someone" },
                    { type: "text", text: response.title ?? "your" },
                    { type: "text", text: String(responseCount?.count ?? 1) },
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

        // SURVEY pattern: "notify me about survey <code>" or "survey <code>"
        const notifyMatch = text.match(/notify\s+me\s+about\s+survey\s+(\S+)/i) || text.match(/survey\s+(\S+)/i);
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
                .prepare("UPDATE creators SET phone = ?, wa_name = ? WHERE id = ?")
                .bind(from, contactName, survey.creator_id)
                .run();

              trackServerEvent(from, "$identify", {
                $set: { phone: from, wa_name: contactName, role: "creator" },
              });

              await wa.sendTemplate(from, "parlo_survey_ready", [
                { type: "body", parameters: [{ type: "text", text: `https://parlo.me/s/${code}` }] },
                { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: code }] },
              ]);
            } else {
              await wa.sendText(from, `No survey found with code "${code}". Check the code and try again.`);
            }
            continue;
          }
        }

    // Unrecognized message — friendly fallback
    console.log(`[webhook] sending fallback to ${from}`);
    try {
      await wa.sendText(
        from,
        "Hey! I'm Parlo, a voice survey bot. Visit parlo.me to create a survey, or paste a code if you have one!"
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

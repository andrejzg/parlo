/**
 * WhatsApp integration via Kapso API.
 */

import { trackServerEvent } from "./analytics";

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

/** Parlo's WhatsApp number (Kapso), digits only; mirrors frontend/src/lib/whatsapp.ts. */
export const PARLO_WHATSAPP_NUMBER = "12015789837";

/** A wa.me deep link into a chat with Parlo's number, `text` prefilled. */
export function buildBotChatUrl(text: string): string {
  return `https://wa.me/${PARLO_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/** Largest inbound media we will pull from Kapso (WhatsApp caps voice notes at 16 MB). */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/**
 * Download an inbound message's media. Kapso v2 webhooks carry a stored copy at
 * `message.kapso.media_url` (api.kapso.ai/media/…, read with the API key); the
 * Meta media id is the fallback (`GET /{media_id}` → a 5-minute URL).
 */
export async function downloadInboundMedia(
  apiKey: string,
  phoneNumberId: string,
  media: { url?: string | null; id?: string | null; contentType?: string | null }
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const tryFetch = async (url: string) => {
    const host = new URL(url).hostname;
    const headers: Record<string, string> = host.endsWith("kapso.ai") ? { "X-API-Key": apiKey } : {};
    const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`media fetch ${res.status} from ${host}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_MEDIA_BYTES) throw new Error("media too large");
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) throw new Error("empty media");
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("media too large");
    const ct = (res.headers.get("content-type") ?? media.contentType ?? "audio/ogg").split(";")[0].trim();
    return { bytes, contentType: ct };
  };

  if (media.url) {
    try {
      return await tryFetch(media.url);
    } catch (err) {
      console.warn("[WhatsApp] media_url download failed, trying the media id", err);
    }
  }
  if (!media.id) throw new Error("no media url or id");
  const meta = await fetch(`${KAPSO_BASE}/${encodeURIComponent(media.id)}?phone_number_id=${encodeURIComponent(phoneNumberId)}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!meta.ok) throw new Error(`media lookup ${meta.status}`);
  const info = (await meta.json()) as { url?: string; mime_type?: string };
  if (!info.url) throw new Error("media lookup returned no url");
  const got = await tryFetch(info.url);
  return { bytes: got.bytes, contentType: info.mime_type?.split(";")[0].trim() || got.contentType };
}

export interface WhatsAppClient {
  sendTemplate(to: string, templateName: string, components: TemplateComponent[]): Promise<void>;
  sendText(to: string, message: string): Promise<void>;
}

interface TemplateComponent {
  type: "body" | "header" | "button";
  sub_type?: "url";
  index?: number;
  // Templates use NAMED params, so body parameters must carry parameter_name.
  // URL button parameters are positional and omit it.
  parameters: { type: "text"; text: string; parameter_name?: string }[];
}

export function createWhatsAppClient(apiKey: string, phoneNumberId: string): WhatsAppClient {
  const headers = {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
  };

  return {
    async sendTemplate(to: string, templateName: string, components: TemplateComponent[]) {
      const res = await fetch(`${KAPSO_BASE}/${phoneNumberId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en_US" },
            components,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[WhatsApp] sendTemplate failed: ${res.status} ${err}`);
      } else {
        trackServerEvent(to, "whatsapp_message_sent", { type: "template", templateName });
      }
    },

    async sendText(to: string, message: string) {
      const res = await fetch(`${KAPSO_BASE}/${phoneNumberId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message },
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[WhatsApp] sendText failed: ${res.status} ${err}`);
      } else {
        trackServerEvent(to, "whatsapp_message_sent", { type: "text" });
      }
    },
  };
}

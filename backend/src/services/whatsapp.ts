/**
 * WhatsApp integration via Kapso API.
 */

import { trackServerEvent } from "./analytics";

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

export interface WhatsAppClient {
  sendTemplate(to: string, templateName: string, components: TemplateComponent[]): Promise<void>;
  sendText(to: string, message: string): Promise<void>;
}

interface TemplateComponent {
  type: "body" | "header" | "button";
  sub_type?: "url";
  index?: number;
  parameters: { type: "text"; text: string }[];
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

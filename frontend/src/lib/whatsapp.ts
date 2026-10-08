/** Parlo's WhatsApp bot number (Kapso), digits only for wa.me links. */
export const PARLO_WHATSAPP_NUMBER = "12015789837";

/** wa.me link that opens a chat with the Parlo bot, prefilled with `text`. */
export function buildBotChatUrl(text: string): string {
  return `https://wa.me/${PARLO_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

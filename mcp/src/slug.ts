/**
 * Share URLs are `parlo.me/s/{slug}-{code}`; the slug is decorative and the
 * trailing code is what the backend reads. Mirrors frontend/src/lib/slug.ts.
 */
export const BASE_URL = "https://parlo.me";

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function buildShareUrl(title: string | null | undefined, code: string): string {
  const slug = title ? slugify(title) : "";
  return slug ? `${BASE_URL}/s/${slug}-${code}` : `${BASE_URL}/s/${code}`;
}

export function buildWhatsAppShareUrl(shareUrl: string): string {
  const text = encodeURIComponent(
    `Hey! I'd love to hear your thoughts. It takes 2 minutes, just tap and talk: ${shareUrl}`,
  );
  return `https://wa.me/?text=${text}`;
}

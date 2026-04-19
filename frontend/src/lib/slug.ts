/**
 * Slug helpers for human-readable share URLs.
 *
 * Pattern: `/s/{slug}-{code}` (GitHub style).
 * The code is the canonical identifier (last 6-12 alphanumeric segment).
 * The slug is decorative and not stored in the DB — it's regenerated from the
 * survey title each time a share URL is built.
 *
 * Bare-code URLs like `/s/2rbee8p6` still work — the regex matches them too.
 */

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Extract the canonical survey code from a possibly-slugged URL segment.
 * Matches the trailing 6-12 alphanumeric chars.
 *
 * extractCode("lemonade-pirates-2rbee8p6") → "2rbee8p6"
 * extractCode("2rbee8p6")                  → "2rbee8p6"
 */
export function extractCode(slugOrCode: string): string {
  const match = slugOrCode.match(/([a-z0-9]{6,12})$/i);
  return match ? match[1] : slugOrCode;
}

/**
 * Build a shareable URL for a survey.
 *
 * buildShareUrl("Lemonade & Pirates", "2rbee8p6")
 *   → "https://parlo.me/s/lemonade-pirates-2rbee8p6"
 */
export function buildShareUrl(
  title: string | null | undefined,
  code: string,
  origin = "https://parlo.me",
): string {
  const slug = title ? slugify(title) : "";
  return slug ? `${origin}/s/${slug}-${code}` : `${origin}/s/${code}`;
}

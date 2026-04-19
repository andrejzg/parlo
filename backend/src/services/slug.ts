/**
 * Extract the canonical survey code from a possibly-slugged URL segment.
 *
 * extractCode("lemonade-pirates-2rbee8p6") → "2rbee8p6"
 * extractCode("2rbee8p6")                  → "2rbee8p6"
 *
 * The slug is decorative; only the trailing 6-12 alphanumeric segment is the
 * actual code stored in the DB. See frontend/src/lib/slug.ts for the
 * companion helper used to build URLs.
 */
export function extractCode(slugOrCode: string): string {
  const match = slugOrCode.match(/([a-z0-9]{6,12})$/i);
  return match ? match[1] : slugOrCode;
}

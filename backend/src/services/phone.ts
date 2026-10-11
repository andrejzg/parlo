/**
 * Phone numbers are stored and compared in E.164 (`+447700900123`).
 *
 * `libphonenumber-js` knows which countries keep a leading zero after the
 * country code (Italy: +39 06…) and which only use it as a trunk prefix
 * that must go (UK: +44 (0)7700…), so this replaces the old regex that
 * stripped every zero it found (CLAUDE.md pitfall 26).
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/min";

export function normalizePhone(raw: string): string {
  let s = raw.trim().replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) s = `+${s}`;
  const parsed = parsePhoneNumberFromString(s);
  return parsed?.number ?? s;
}

/**
 * The normaliser used before 2026-10-11. Kept only so lookups can find and
 * heal rows it mangled (a Slovenian +386 40… was stored as +386 4…).
 */
export function legacyNormalizePhone(raw: string): string {
  return raw.trim().replace(/^(\+\d{1,4})0+/, "$1");
}

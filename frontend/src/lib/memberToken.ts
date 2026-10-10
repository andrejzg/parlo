/**
 * Member tokens: the per-member secret that personal links carry
 * (`parlo.me/s/<code>?t=<token>`). Answering a parlo makes you a member and
 * the submit response returns your token; we keep it per parlo code so a
 * returning visitor gets their personal asks and the report without a link.
 */

const PREFIX = "parlo-member:";

export function getMemberToken(code: string): string | null {
  try {
    return localStorage.getItem(PREFIX + code);
  } catch {
    return null;
  }
}

export function saveMemberToken(code: string, token: string): void {
  try {
    localStorage.setItem(PREFIX + code, token);
  } catch {
    // storage unavailable — the token still lives in this page's state
  }
}

export function clearMemberToken(code: string): void {
  try {
    localStorage.removeItem(PREFIX + code);
  } catch {
    // ignore
  }
}

/** Read `?t=` from the current URL (and keep it out of history). */
export function readTokenFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("t");
    if (!t) return null;
    params.delete("t");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    return t;
  } catch {
    return null;
  }
}

/** Build a personal link for a member. */
export function buildPersonalLink(shareUrl: string, token: string): string {
  return `${shareUrl}${shareUrl.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

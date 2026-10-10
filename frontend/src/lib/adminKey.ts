/**
 * The admin API (api.parlo.me/api/admin/*) is gated by a shared secret
 * because Cloudflare Access cookies for parlo.me/admin don't reach the API
 * host. The key is pasted once on the admin page and kept in localStorage.
 */
const STORAGE_KEY = "parlo-admin-key";

export function getAdminKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAdminKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key.trim());
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function adminHeaders(): Record<string, string> {
  const key = getAdminKey();
  return key ? { "X-Parlo-Admin-Key": key } : {};
}

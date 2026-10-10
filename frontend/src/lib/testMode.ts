/**
 * Team / automated traffic tagging.
 *
 * Visit parlo.me/?test=1 once on a device to mark it (stored in
 * localStorage; ?test=0 clears it). Localhost and Pages preview hosts are
 * always test. When on, every API call carries `X-Parlo-Test: 1` (the
 * backend stamps `is_test` on surveys and server events) and PostHog events
 * from the browser carry `is_test: true`, so dashboards and the admin
 * Creations tab can leave our own runs out.
 */

const STORAGE_KEY = "parlo-test-mode";

let cached: boolean | null = null;

export function isTestMode(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return false;

  let on = false;
  try {
    const flag = new URLSearchParams(window.location.search).get("test");
    if (flag === "1" || flag === "true") localStorage.setItem(STORAGE_KEY, "1");
    else if (flag === "0" || flag === "false") localStorage.removeItem(STORAGE_KEY);
    on = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode / blocked storage: fall through to host-based detection.
  }

  if (!on) {
    const host = window.location.hostname;
    on =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost") ||
      host.endsWith(".pages.dev");
  }

  cached = on;
  return on;
}

/** Headers to spread into API requests. */
export function testHeaders(): Record<string, string> {
  return isTestMode() ? { "X-Parlo-Test": "1" } : {};
}

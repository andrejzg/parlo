/**
 * Server-side PostHog analytics.
 *
 * Uses the PostHog HTTP API directly (no heavyweight SDK) to keep the Worker
 * bundle small and avoid Node.js-only dependencies.
 */

const POSTHOG_HOST = "https://us.i.posthog.com";

let _apiKey: string | undefined;

let _waitUntil: ((p: Promise<unknown>) => void) | undefined;

/**
 * `waitUntil` keeps the Worker alive until in-flight analytics fetches finish.
 * Without it, Workers cancels outstanding subrequests once the response is
 * sent, and fire-and-forget events never reach PostHog.
 */
export function initAnalytics(apiKey: string | undefined, waitUntil?: (p: Promise<unknown>) => void): void {
  _apiKey = apiKey;
  _waitUntil = waitUntil;
}

/**
 * Fire-and-forget server event. Never throws — analytics failures must not
 * break business logic.
 */
export function trackServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!_apiKey) return;

  const body = JSON.stringify({
    api_key: _apiKey,
    event,
    distinct_id: distinctId,
    properties: {
      ...properties,
      $lib: "parlo-backend",
    },
    timestamp: new Date().toISOString(),
  });

  // Non-blocking — we intentionally don't await, but register with waitUntil
  const sent = fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    // Swallow errors — analytics should never take down the request
  });
  _waitUntil?.(sent);
}

/**
 * Report a thrown error as a PostHog `$exception` event so it shows up in
 * PostHog's Error Tracking UI. Returns the in-flight fetch promise so callers
 * can `ctx.waitUntil(...)` it to keep the Worker alive long enough to flush.
 */
export function captureServerException(
  distinctId: string,
  error: unknown,
  properties?: Record<string, unknown>,
): Promise<void> | undefined {
  if (!_apiKey) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const type = err.name || "Error";

  const body = JSON.stringify({
    api_key: _apiKey,
    event: "$exception",
    distinct_id: distinctId,
    properties: {
      $exception_list: [
        {
          type,
          value: err.message,
          mechanism: { handled: false, synthetic: false },
          stacktrace: err.stack ? { type: "raw", frames: [] } : undefined,
        },
      ],
      $exception_message: err.message,
      $exception_type: type,
      $exception_stack_trace_raw: err.stack,
      $lib: "parlo-backend",
      ...properties,
    },
    timestamp: new Date().toISOString(),
  });

  return fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
    .then(() => undefined)
    .catch(() => undefined);
}

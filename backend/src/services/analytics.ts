/**
 * Server-side PostHog analytics.
 *
 * Uses the PostHog HTTP API directly (no heavyweight SDK) to keep the Worker
 * bundle small and avoid Node.js-only dependencies.
 */

const POSTHOG_HOST = "https://eu.i.posthog.com";

let _apiKey: string | undefined;

export function initAnalytics(apiKey: string | undefined): void {
  _apiKey = apiKey;
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

  // Non-blocking — we intentionally don't await
  fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    // Swallow errors — analytics should never take down the request
  });
}

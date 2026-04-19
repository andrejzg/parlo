import posthogLib from "posthog-js";

const posthogKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const posthogHost =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
  "https://us.i.posthog.com";

/** Singleton PostHog instance — `null` when no key is configured (e.g. local dev). */
export const posthog =
  posthogKey
    ? posthogLib.init(posthogKey, {
        api_host: posthogHost,
        capture_pageview: true,
        capture_pageleave: true,
        capture_exceptions: true,
      })
    : null;

/**
 * Lightweight wrapper that silently no-ops when PostHog isn't initialised.
 */
export function trackEvent(
  name: string,
  properties?: Record<string, unknown>,
): void {
  if (!posthog) return;
  posthog.capture(name, properties);
}

/**
 * Manually report an error to PostHog. Use in try/catch blocks where the error
 * is handled and therefore won't reach `window.onerror`.
 */
export function captureException(
  error: unknown,
  properties?: Record<string, unknown>,
): void {
  if (!posthog) return;
  const err = error instanceof Error ? error : new Error(String(error));
  posthog.captureException(err, properties);
}

/**
 * Identify a user with their phone number + name.
 * Call this when we collect participant/creator identity.
 */
export function identifyUser(
  phone: string,
  properties?: { firstName?: string; lastName?: string; role?: "creator" | "participant" },
): void {
  if (!posthog) return;
  posthog.identify(phone, {
    phone,
    ...(properties?.firstName && { first_name: properties.firstName }),
    ...(properties?.lastName && { last_name: properties.lastName }),
    ...(properties?.role && { role: properties.role }),
  });
}

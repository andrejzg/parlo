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

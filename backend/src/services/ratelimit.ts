/**
 * Simple KV-based rate limiter.
 *
 * Key pattern: `ratelimit:{action}:{identifier}`
 * Value: numeric count string
 * TTL: 3600 seconds (1 hour)
 *
 * Returns `true` if the request is allowed, `false` if the limit is exceeded.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  action: string,
  identifier: string,
  limit: number
): Promise<boolean> {
  const key = `ratelimit:${action}:${identifier}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return false;
  }

  await kv.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
}

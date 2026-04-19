import { generateId } from "./codes";

/**
 * Generate a one-time upload token for an R2 key.
 * Stored in KV with a 10-minute TTL, keyed as `upload-token:{r2Key}`.
 */
export async function generateUploadToken(
  kv: KVNamespace,
  r2Key: string
): Promise<string> {
  const token = generateId();
  await kv.put(`upload-token:${r2Key}`, token, { expirationTtl: 600 });
  return token;
}

/**
 * Validate and consume a one-time upload token.
 * Returns true if valid (and deletes the token), false otherwise.
 */
export async function validateUploadToken(
  kv: KVNamespace,
  r2Key: string,
  token: string
): Promise<boolean> {
  const stored = await kv.get(`upload-token:${r2Key}`);
  if (!stored || stored !== token) {
    return false;
  }
  await kv.delete(`upload-token:${r2Key}`);
  return true;
}

/**
 * Generate a time-limited read token for an R2 key.
 * Stored in KV with a 1-hour TTL, keyed as `read-token:{r2Key}`.
 */
export async function generateReadToken(
  kv: KVNamespace,
  r2Key: string
): Promise<string> {
  const token = generateId();
  await kv.put(`read-token:${r2Key}`, token, { expirationTtl: 3600 });
  return token;
}

/**
 * Validate a read token (does NOT delete — allows multiple reads within TTL).
 */
export async function validateReadToken(
  kv: KVNamespace,
  r2Key: string,
  token: string
): Promise<boolean> {
  const stored = await kv.get(`read-token:${r2Key}`);
  return stored !== null && stored === token;
}

/**
 * Generate a presigned URL for uploading an audio file to R2.
 * Now includes a one-time upload token as a query parameter.
 */
export function generatePresignedUploadUrl(
  baseUrl: string,
  r2Key: string,
  token: string
): string {
  return `${baseUrl}/api/upload/${encodeURIComponent(r2Key)}?token=${token}`;
}

/**
 * Generate a presigned URL for reading/downloading an audio file from R2.
 * Now includes a time-limited read token as a query parameter.
 */
export function generatePresignedReadUrl(
  baseUrl: string,
  r2Key: string,
  token: string
): string {
  return `${baseUrl}/api/audio/${encodeURIComponent(r2Key)}?token=${token}`;
}

/**
 * Upload audio data directly to R2.
 */
export async function uploadToR2(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream | ArrayBuffer | string,
  contentType: string = "audio/webm"
): Promise<R2Object> {
  return bucket.put(key, body, {
    httpMetadata: { contentType },
  });
}

/**
 * Get an object from R2.
 */
export async function getFromR2(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

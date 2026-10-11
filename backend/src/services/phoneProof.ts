/**
 * Server-side proof that the caller owns a phone number.
 *
 * Identity is never taken from a phone number in a request body. Two proofs
 * count:
 *
 *  - a Firebase ID token: the browser confirmed an SMS code with Firebase and
 *    holds a signed JWT. It is verified here against Google's published
 *    signing keys with Web Crypto (RS256) — no Admin SDK, which Workers
 *    can't run anyway. The `phone_number` claim is the verified phone.
 *  - a proof token minted by POST /api/otp/verify-whatsapp once the WhatsApp
 *    code checked out server-side. Random, lives in KV for ten minutes.
 */
import type { Env } from "../types";
import { normalizePhone } from "./groups";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const JWKS_KV_KEY = "firebase-jwks";
const PROOF_TTL_SECONDS = 600;
/** Clock skew tolerated on `iat` / `auth_time`. */
const SKEW_SECONDS = 300;

export type PhoneProofCode = "malformed" | "unknown_key" | "bad_signature" | "expired" | "wrong_audience" | "no_phone" | "missing" | "unconfigured";

export class PhoneProofError extends Error {
  constructor(message: string, public code: PhoneProofCode, public status: 400 | 401 = 401) {
    super(message);
    this.name = "PhoneProofError";
  }
}

export interface SigningKey {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

export interface FirebaseClaims {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  auth_time?: number;
  phone_number?: string;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson<T>(s: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
  } catch {
    throw new PhoneProofError("Malformed ID token", "malformed");
  }
}

/**
 * Pure verifier: signature against the given keys, then the claims Firebase
 * documents for ID tokens. Exported so it can be exercised without Google.
 */
export async function verifyFirebaseIdTokenWithKeys(
  token: string,
  keys: SigningKey[],
  projectId: string,
  now = Math.floor(Date.now() / 1000),
): Promise<FirebaseClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new PhoneProofError("Malformed ID token", "malformed");
  const header = b64urlJson<{ alg?: string; kid?: string }>(parts[0]);
  if (header.alg !== "RS256" || !header.kid) throw new PhoneProofError("Unsupported ID token", "malformed");
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new PhoneProofError("Unknown signing key", "unknown_key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new PhoneProofError("ID token signature is invalid", "bad_signature");

  const claims = b64urlJson<FirebaseClaims>(parts[1]);
  if (claims.aud !== projectId) throw new PhoneProofError("ID token is for another project", "wrong_audience");
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new PhoneProofError("ID token issuer is wrong", "wrong_audience");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new PhoneProofError("ID token has expired", "expired");
  if (typeof claims.iat !== "number" || claims.iat > now + SKEW_SECONDS) throw new PhoneProofError("ID token is not valid yet", "expired");
  if (typeof claims.auth_time === "number" && claims.auth_time > now + SKEW_SECONDS) throw new PhoneProofError("ID token is not valid yet", "expired");
  if (typeof claims.sub !== "string" || !claims.sub) throw new PhoneProofError("ID token has no subject", "malformed");
  return claims;
}

async function loadSigningKeys(kv: KVNamespace, fresh = false): Promise<SigningKey[]> {
  if (!fresh) {
    const cached = await kv.get<SigningKey[]>(JWKS_KV_KEY, "json");
    if (cached?.length) return cached;
  }
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new PhoneProofError("Could not fetch Firebase signing keys", "unknown_key");
  const { keys } = await res.json<{ keys: SigningKey[] }>();
  // Google says how long the keys stay valid; cache that long, within reason.
  const maxAge = Number(res.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 0);
  const ttl = Math.max(600, Math.min(maxAge || 3600, 86_400));
  await kv.put(JWKS_KV_KEY, JSON.stringify(keys), { expirationTtl: ttl });
  return keys;
}

/** Verify a Firebase ID token and return the phone it was issued for (E.164, normalised). */
export async function verifyFirebaseIdToken(env: Env, token: string): Promise<string> {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new PhoneProofError("Phone verification is not configured", "unconfigured");
  let claims: FirebaseClaims;
  try {
    claims = await verifyFirebaseIdTokenWithKeys(token, await loadSigningKeys(env.KV), projectId);
  } catch (err) {
    // Google rotates keys; a kid we don't know means our cache is stale.
    if (err instanceof PhoneProofError && err.code === "unknown_key") {
      claims = await verifyFirebaseIdTokenWithKeys(token, await loadSigningKeys(env.KV, true), projectId);
    } else {
      throw err;
    }
  }
  if (!claims.phone_number) throw new PhoneProofError("ID token carries no phone number", "no_phone");
  return normalizePhone(claims.phone_number);
}

/** After a WhatsApp code checked out: a random token the client trades in for a login. */
export async function mintPhoneProof(kv: KVNamespace, phone: string): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = bytesToB64url(bytes);
  await kv.put(`phone-proof:${token}`, normalizePhone(phone), { expirationTtl: PROOF_TTL_SECONDS });
  return token;
}

export async function readPhoneProof(kv: KVNamespace, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  return kv.get(`phone-proof:${token}`);
}

export interface PhoneProofInput {
  idToken?: unknown;
  proof?: unknown;
}

export interface VerifiedPhone {
  phone: string;
  method: "firebase" | "whatsapp";
}

/** The verified phone behind a request body, or a PhoneProofError (401/400). */
export async function resolveVerifiedPhone(env: Env, body: PhoneProofInput): Promise<VerifiedPhone> {
  if (typeof body.idToken === "string" && body.idToken) {
    return { phone: await verifyFirebaseIdToken(env, body.idToken), method: "firebase" };
  }
  if (typeof body.proof === "string" && body.proof) {
    const phone = await readPhoneProof(env.KV, body.proof);
    if (!phone) throw new PhoneProofError("That verification has expired. Please verify your number again.", "expired");
    return { phone, method: "whatsapp" };
  }
  throw new PhoneProofError("Verify your phone number first", "missing");
}

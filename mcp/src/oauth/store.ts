import type {
  StoredClient,
  StoredAuthCode,
  StoredAccessToken,
  StoredRefreshToken,
} from "./types";

const TTL_AUTH_CODE = 600; // 10 minutes
const TTL_ACCESS_TOKEN = 3600; // 1 hour
const TTL_REFRESH_TOKEN = 30 * 24 * 60 * 60; // 30 days

export class OAuthStore {
  constructor(private kv: KVNamespace) {}

  // --- Clients ---

  async saveClient(client: StoredClient): Promise<void> {
    await this.kv.put(
      `oauth:client:${client.clientId}`,
      JSON.stringify(client)
    );
  }

  async getClient(clientId: string): Promise<StoredClient | null> {
    const raw = await this.kv.get(`oauth:client:${clientId}`);
    return raw ? (JSON.parse(raw) as StoredClient) : null;
  }

  // --- Auth Codes ---

  async saveAuthCode(authCode: StoredAuthCode): Promise<void> {
    await this.kv.put(
      `oauth:code:${authCode.code}`,
      JSON.stringify(authCode),
      { expirationTtl: TTL_AUTH_CODE }
    );
  }

  async getAuthCode(code: string): Promise<StoredAuthCode | null> {
    const raw = await this.kv.get(`oauth:code:${code}`);
    return raw ? (JSON.parse(raw) as StoredAuthCode) : null;
  }

  async deleteAuthCode(code: string): Promise<void> {
    await this.kv.delete(`oauth:code:${code}`);
  }

  // --- Access Tokens ---

  async saveAccessToken(token: string, data: StoredAccessToken): Promise<void> {
    await this.kv.put(`oauth:token:${token}`, JSON.stringify(data), {
      expirationTtl: TTL_ACCESS_TOKEN,
    });
  }

  async getAccessToken(token: string): Promise<StoredAccessToken | null> {
    const raw = await this.kv.get(`oauth:token:${token}`);
    return raw ? (JSON.parse(raw) as StoredAccessToken) : null;
  }

  // --- Refresh Tokens ---

  async saveRefreshToken(
    token: string,
    data: StoredRefreshToken
  ): Promise<void> {
    await this.kv.put(`oauth:refresh:${token}`, JSON.stringify(data), {
      expirationTtl: TTL_REFRESH_TOKEN,
    });
  }

  async getRefreshToken(token: string): Promise<StoredRefreshToken | null> {
    const raw = await this.kv.get(`oauth:refresh:${token}`);
    return raw ? (JSON.parse(raw) as StoredRefreshToken) : null;
  }

  // --- Utilities ---

  generateToken(length = 48): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
}

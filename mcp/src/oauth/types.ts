export interface StoredClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName?: string;
  grantTypes: string[];
  responseTypes: string[];
  createdAt: number;
}

export interface StoredAuthCode {
  code: string;
  apiKey: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  expiresAt: number;
}

export interface StoredAccessToken {
  apiKey: string;
  clientId: string;
  expiresAt: number;
}

export interface StoredRefreshToken {
  apiKey: string;
  clientId: string;
  createdAt: number;
}

import { randomBytes } from 'node:crypto';
import type { OAuthManager } from './types.js';

type SettingsStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
};

type RefreshTokenStore = {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(value: string): Promise<unknown>;
  deleteRefreshToken(): Promise<unknown>;
};

type OAuthDeps = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  getCredentials?: () => Promise<{ clientId: string; clientSecret: string }>;
  randomState?: () => string;
  fetch?: typeof fetch;
  settings: SettingsStore;
  tokenStore: RefreshTokenStore;
  getLaunchAgentInstalled?: () => Promise<boolean>;
  notificationsEnabled?: () => Promise<boolean>;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

const ACCESS_TOKEN = 'access_token';
const ACCESS_TOKEN_EXPIRES_AT = 'access_token_expires_at';
const OAUTH_STATE = 'oauth_state';
const USERNAME = 'username';
const NICKNAME = 'nickname';
const LAST_SYNC_AT = 'last_sync_at';

export function createOAuthManager(deps: OAuthDeps): OAuthManager {
  const fetchImpl = deps.fetch ?? fetch;
  const randomState = deps.randomState ?? (() => randomBytes(24).toString('hex'));
  const redirectUri = `${deps.baseUrl.replace(/\/$/, '')}/auth/callback`;

  async function exchangeToken(params: Record<string, string>): Promise<TokenResponse> {
    const response = await fetchImpl('https://bgm.tv/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(params)
    });

    if (!response.ok) {
      throw new Error(`Bangumi token request failed: ${response.status}`);
    }

    return (await response.json()) as TokenResponse;
  }

  async function getCredentials(): Promise<{ clientId: string; clientSecret: string }> {
    const saved = await deps.getCredentials?.();
    return {
      clientId: deps.clientId || saved?.clientId || '',
      clientSecret: deps.clientSecret || saved?.clientSecret || ''
    };
  }

  async function assertConfigured(): Promise<{ clientId: string; clientSecret: string }> {
    const credentials = await getCredentials();
    if (!credentials.clientId || !credentials.clientSecret) {
      throw Object.assign(new Error('在设置里填写 Bangumi App ID 和 App Secret 后再连接 Bangumi'), {
        statusCode: 400
      });
    }
    return credentials;
  }

  async function storeToken(token: TokenResponse): Promise<void> {
    await deps.settings.set(ACCESS_TOKEN, token.access_token);
    const expiresAt = Date.now() + token.expires_in * 1000 - 60_000;
    await deps.settings.set(ACCESS_TOKEN_EXPIRES_AT, String(expiresAt));
    if (token.refresh_token) {
      await deps.tokenStore.setRefreshToken(token.refresh_token);
    }
  }

  return {
    async createAuthorizationUrl() {
      const credentials = await assertConfigured();
      const state = randomState();
      await deps.settings.set(OAUTH_STATE, state);

      const url = new URL('https://bgm.tv/oauth/authorize');
      url.searchParams.set('client_id', credentials.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'write:collection');
      url.searchParams.set('state', state);
      return url;
    },

    async handleCallback(code, state) {
      const credentials = await assertConfigured();
      const expectedState = await deps.settings.get(OAUTH_STATE);
      if (!expectedState || expectedState !== state) {
        throw new Error('Invalid OAuth state');
      }

      const token = await exchangeToken({
        grant_type: 'authorization_code',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: redirectUri,
        state
      });
      await storeToken(token);
      await deps.settings.set(OAUTH_STATE, '');
    },

    async getAccessToken() {
      const accessToken = await deps.settings.get(ACCESS_TOKEN);
      const expiresAt = Number(await deps.settings.get(ACCESS_TOKEN_EXPIRES_AT));
      if (accessToken && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        return accessToken;
      }

      const refreshToken = await deps.tokenStore.getRefreshToken();
      if (!refreshToken) {
        throw new Error('Bangumi is not connected');
      }

      const credentials = await assertConfigured();
      const token = await exchangeToken({
        grant_type: 'refresh_token',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: refreshToken,
        redirect_uri: redirectUri
      });
      await storeToken(token);
      return token.access_token;
    },

    async getAuthStatus() {
      const [username, nickname, lastSyncAt, refreshToken, launchAgentInstalled, notificationsEnabled, credentials] = await Promise.all([
        deps.settings.get(USERNAME),
        deps.settings.get(NICKNAME),
        deps.settings.get(LAST_SYNC_AT),
        deps.tokenStore.getRefreshToken(),
        deps.getLaunchAgentInstalled?.() ?? Promise.resolve(false),
        deps.notificationsEnabled?.() ?? Promise.resolve(true),
        getCredentials()
      ]);
      const accessToken = await deps.settings.get(ACCESS_TOKEN);

      return {
        authenticated: Boolean(username && (refreshToken || accessToken)),
        username,
        nickname,
        lastSyncAt,
        configured: Boolean(credentials.clientId && credentials.clientSecret),
        oauthClientId: credentials.clientId || null,
        callbackUrl: redirectUri,
        notificationsEnabled,
        launchAgentInstalled
      };
    }
  };
}

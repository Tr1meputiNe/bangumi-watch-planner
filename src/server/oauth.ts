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
  runtimePlatform?: 'macOS' | 'Windows' | 'Linux' | 'Other';
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

const ACCESS_TOKEN = 'access_token';
const ACCESS_TOKEN_EXPIRES_AT = 'access_token_expires_at';
const AUTH_MODE = 'auth_mode';
const OAUTH_STATE = 'oauth_state';
const USERNAME = 'username';
const NICKNAME = 'nickname';
const LAST_SYNC_AT = 'last_sync_at';

export function createOAuthManager(deps: OAuthDeps): OAuthManager {
  const fetchImpl = deps.fetch ?? fetch;
  const randomState = deps.randomState ?? (() => randomBytes(24).toString('hex'));
  const redirectUri = `${deps.baseUrl.replace(/\/$/, '')}/auth/callback`;
  let accessTokenRequest: Promise<string> | null = null;

  async function exchangeToken(params: Record<string, string>): Promise<TokenResponse> {
    const response = await fetchImpl('https://bgm.tv/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000)
    }).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw oauthError('Bangumi 登录服务响应超时，请稍后重试', 502);
      }
      throw error;
    });

    if (!response.ok) {
      throw oauthError(
        response.status >= 500
          ? 'Bangumi 登录服务暂时不可用，请稍后重试'
          : 'Bangumi 授权已失效，请重新登录',
        response.status >= 500 ? 502 : 400
      );
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
      throw oauthError('填写 Bangumi App ID 和 App Secret 后再连接 Bangumi', 400);
    }
    return credentials;
  }

  async function storeToken(token: TokenResponse): Promise<void> {
    if (token.refresh_token) {
      await deps.tokenStore.setRefreshToken(token.refresh_token);
    }
    await deps.settings.set(ACCESS_TOKEN, token.access_token);
    const expiresAt = Date.now() + token.expires_in * 1000 - 60_000;
    await deps.settings.set(ACCESS_TOKEN_EXPIRES_AT, String(expiresAt));
    await deps.settings.set(AUTH_MODE, 'oauth');
  }

  async function loadAccessToken(): Promise<string> {
    const accessToken = await getCachedAccessToken();
    if (accessToken) return accessToken;
    if (await deps.settings.get(AUTH_MODE) === 'personal') {
      throw oauthError('个人令牌已失效，请重新连接 Bangumi', 401);
    }

    const refreshToken = await deps.tokenStore.getRefreshToken();
    if (!refreshToken) {
      throw oauthError('Bangumi 尚未登录', 401);
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
  }

  async function getCachedAccessToken(): Promise<string | null> {
    const [accessToken, expiresAtValue] = await Promise.all([
      deps.settings.get(ACCESS_TOKEN),
      deps.settings.get(ACCESS_TOKEN_EXPIRES_AT)
    ]);
    const expiresAt = Number(expiresAtValue);
    return accessToken && Number.isFinite(expiresAt) && expiresAt > Date.now() ? accessToken : null;
  }

  return {
    async setPersonalAccessToken(value) {
      const accessToken = value.trim();
      if (!/^[\x21-\x7e]{8,2048}$/.test(accessToken)) {
        throw oauthError('请粘贴完整的个人令牌', 400);
      }
      const signal = AbortSignal.timeout(15_000);
      try {
        const [userResponse, tokenResponse] = await Promise.all([
          fetchImpl('https://api.bgm.tv/v0/me', {
            headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'bangumi-watch-planner/1.4.0' },
            redirect: 'error', signal
          }),
          fetchImpl('https://bgm.tv/oauth/token_status', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ access_token: accessToken }), redirect: 'error', signal
          })
        ]);
        if (!userResponse.ok || !tokenResponse.ok) {
          const invalid = [userResponse.status, tokenResponse.status].some((status) => status === 400 || status === 401 || status === 403);
          throw oauthError(invalid ? '个人令牌无效或已过期，请重新生成' : 'Bangumi 暂时无法连接，请稍后重试', invalid ? 400 : 502);
        }
        const user = await userResponse.json() as { id?: unknown; username?: unknown; nickname?: unknown };
        const token = await tokenResponse.json() as { expires?: unknown; user_id?: unknown };
        const expires = Number(token.expires);
        if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0 || typeof user.username !== 'string' || !user.username.trim()
          || !Number.isFinite(expires) || expires * 1000 <= Date.now() || Number(token.user_id) !== user.id) {
          throw oauthError('个人令牌无效或已过期，请重新生成', 400);
        }
        // Only persist after both identity and the real remote expiry are verified.
        await deps.settings.set(ACCESS_TOKEN, accessToken);
        await deps.settings.set(ACCESS_TOKEN_EXPIRES_AT, String(expires * 1000));
        await deps.settings.set(AUTH_MODE, 'personal');
        await deps.settings.set(USERNAME, user.username);
        await deps.settings.set(NICKNAME, typeof user.nickname === 'string' ? user.nickname : user.username);
      } catch (error) {
        if (error instanceof Error && 'expose' in error) throw error;
        throw oauthError(signal.aborted ? 'Bangumi 连接超时，请稍后重试' : 'Bangumi 暂时无法连接，请稍后重试', 502);
      }
    },

    async invalidateAccessToken(rejectedToken) {
      const current = await deps.settings.get(ACCESS_TOKEN);
      if (rejectedToken && rejectedToken !== current) return;
      await deps.settings.set(ACCESS_TOKEN, '');
      await deps.settings.set(ACCESS_TOKEN_EXPIRES_AT, '');
    },

    async createAuthorizationUrl() {
      const credentials = await assertConfigured();
      const state = randomState();
      await deps.settings.set(OAUTH_STATE, state);

      const url = new URL('https://bgm.tv/oauth/authorize');
      url.searchParams.set('client_id', credentials.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      return url;
    },

    async handleCallback(code, state) {
      const credentials = await assertConfigured();
      const expectedState = await deps.settings.get(OAUTH_STATE);
      if (!expectedState || expectedState !== state) {
        throw oauthError('Bangumi 登录链接已失效，请重新登录', 400);
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

    getAccessToken() {
      accessTokenRequest ??= loadAccessToken().finally(() => { accessTokenRequest = null; });
      return accessTokenRequest;
    },

    async getAuthStatus() {
      const [username, nickname, lastSyncAt, refreshToken, accessToken, launchAgentInstalled, notificationsEnabled, credentials, mode] = await Promise.all([
        deps.settings.get(USERNAME),
        deps.settings.get(NICKNAME),
        deps.settings.get(LAST_SYNC_AT),
        deps.tokenStore.getRefreshToken(),
        getCachedAccessToken(),
        deps.getLaunchAgentInstalled?.() ?? Promise.resolve(false),
        deps.notificationsEnabled?.() ?? Promise.resolve(true),
        getCredentials(),
        deps.settings.get(AUTH_MODE)
      ]);

      return {
        authenticated: Boolean(username && (accessToken || (mode !== 'personal' && refreshToken))),
        username,
        nickname,
        lastSyncAt,
        configured: Boolean(credentials.clientId && credentials.clientSecret),
        oauthClientId: credentials.clientId || null,
        callbackUrl: redirectUri,
        notificationsEnabled,
        launchAgentInstalled,
        ...(deps.runtimePlatform ? { runtimePlatform: deps.runtimePlatform } : {})
      };
    }
  };
}

function oauthError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

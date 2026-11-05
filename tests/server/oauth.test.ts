import { describe, expect, it, vi } from 'vitest';
import { createOAuthManager } from '../../src/server/oauth.js';

describe('personal token connection', () => {
  function setup(fetcher: typeof fetch, initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    const refresh = vi.fn(async () => 'previous-oauth-refresh');
    const manager = createOAuthManager({ clientId: '', clientSecret: '', baseUrl: 'http://127.0.0.1:3777', fetch: fetcher,
      settings: { get: async (key) => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); } },
      tokenStore: { getRefreshToken: refresh, setRefreshToken: vi.fn(), deleteRefreshToken: vi.fn() } });
    return { manager, values, refresh };
  }

  function validResponses(expires = Math.floor(Date.now() / 1000) + 3600) {
    return vi.fn(async (url: RequestInfo | URL) => url.toString() === 'https://api.bgm.tv/v0/me'
      ? Response.json({ id: 123, username: 'token-user', nickname: '令牌用户' })
      : Response.json({ user_id: 123, expires }));
  }

  it('validates identity and real expiry before persisting a token, without needing OAuth credentials', async () => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const fetcher = validResponses(expires);
    const { manager, values } = setup(fetcher);
    await manager.setPersonalAccessToken!('  personal-token  ');
    expect(values.get('access_token')).toBe('personal-token');
    expect(values.get('access_token_expires_at')).toBe(String(expires * 1000));
    expect(values.get('auth_mode')).toBe('personal');
    expect(await manager.getAccessToken()).toBe('personal-token');
    expect(await manager.getAuthStatus()).toMatchObject({ authenticated: true, configured: false, username: 'token-user', nickname: '令牌用户' });
    expect(fetcher).toHaveBeenCalledWith('https://api.bgm.tv/v0/me', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer personal-token' }) }));
    expect(fetcher).toHaveBeenCalledWith('https://bgm.tv/oauth/token_status', expect.objectContaining({ method: 'POST', body: expect.any(URLSearchParams) }));
    expect(JSON.stringify(await manager.getAuthStatus())).not.toContain('personal-token');
  });

  it('does not replace a working login when a submitted token is invalid', async () => {
    const original = { access_token: 'working-token', access_token_expires_at: String(Date.now() + 3600000), username: 'existing', auth_mode: 'oauth' };
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
    const { manager, values } = setup(fetcher, original);
    await expect(manager.setPersonalAccessToken!('invalid-token')).rejects.toMatchObject({ statusCode: 400 });
    expect(Object.fromEntries(values)).toEqual(original);
  });

  it('rejects expired or mismatched token metadata before making any local changes', async () => {
    const { manager, values } = setup(validResponses(Math.floor(Date.now() / 1000) - 1));
    await expect(manager.setPersonalAccessToken!('expired-token')).rejects.toMatchObject({ statusCode: 400 });
    expect(values.size).toBe(0);
  });

  it('reports validation timeouts without storing or exposing the submitted token', async () => {
    const signal = AbortSignal.abort(new DOMException('Timeout', 'TimeoutError'));
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const { manager, values } = setup(vi.fn(async () => { throw signal.reason; }));
    try {
      await expect(manager.setPersonalAccessToken!('secret-test-token')).rejects.toMatchObject({ statusCode: 502, message: 'Bangumi 连接超时，请稍后重试' });
      expect(values.size).toBe(0);
    } finally { timeout.mockRestore(); }
  });

  it('does not fall back to another account refresh token after personal token expiry', async () => {
    const fetcher = validResponses();
    const { manager } = setup(fetcher);
    await manager.setPersonalAccessToken!('personal-token');
    await manager.invalidateAccessToken!('personal-token');
    expect(await manager.getAuthStatus()).toMatchObject({ authenticated: false });
    await expect(manager.getAccessToken()).rejects.toMatchObject({ statusCode: 401 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed 401 for the replaced token', async () => {
    const { manager } = setup(validResponses());
    await manager.setPersonalAccessToken!('new-personal-token');
    await manager.invalidateAccessToken!('previous-personal-token');
    expect(await manager.getAccessToken()).toBe('new-personal-token');
    expect(await manager.getAuthStatus()).toMatchObject({ authenticated: true });
  });

  it('reports an elapsed personal token expiry as logged out even if an older OAuth refresh exists', async () => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const { manager } = setup(validResponses(expires));
    await manager.setPersonalAccessToken!('personal-token');
    const now = vi.spyOn(Date, 'now').mockReturnValue((expires + 1) * 1000);
    try {
      expect(await manager.getAuthStatus()).toMatchObject({ authenticated: false });
      await expect(manager.getAccessToken()).rejects.toMatchObject({ statusCode: 401 });
    } finally { now.mockRestore(); }
  });
});

describe('OAuth manager', () => {
  it('builds a Bangumi authorization URL and persists state', async () => {
    const settings = new Map<string, string>();
    const manager = createOAuthManager({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'http://127.0.0.1:3777',
      randomState: () => 'state-123',
      fetch: vi.fn(),
      settings: {
        get: async (key) => settings.get(key) ?? null,
        set: async (key, value) => settings.set(key, value)
      },
      tokenStore: {
        getRefreshToken: async () => null,
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    const url = await manager.createAuthorizationUrl();

    expect(url.origin).toBe('https://bgm.tv');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3777/auth/callback');
    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(settings.get('oauth_state')).toBe('state-123');
  });

  it('can build a login URL from runtime-saved OAuth credentials', async () => {
    const settings = new Map<string, string>();
    const manager = createOAuthManager({
      clientId: '',
      clientSecret: '',
      baseUrl: 'http://127.0.0.1:3777',
      randomState: () => 'state-456',
      getCredentials: async () => ({ clientId: 'saved-client', clientSecret: 'saved-secret' }),
      fetch: vi.fn(),
      settings: {
        get: async (key) => settings.get(key) ?? null,
        set: async (key, value) => settings.set(key, value)
      },
      tokenStore: {
        getRefreshToken: async () => null,
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    const url = await manager.createAuthorizationUrl();

    expect(url.searchParams.get('client_id')).toBe('saved-client');
    expect(settings.get('oauth_state')).toBe('state-456');
  });

  it('reports the callback URL that must be used in Bangumi developer settings', async () => {
    const manager = createOAuthManager({
      clientId: '',
      clientSecret: '',
      baseUrl: 'http://127.0.0.1:3777',
      runtimePlatform: 'Windows',
      getCredentials: async () => ({ clientId: 'saved-client', clientSecret: 'saved-secret' }),
      fetch: vi.fn(),
      settings: {
        get: async () => null,
        set: async () => undefined
      },
      tokenStore: {
        getRefreshToken: async () => null,
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    await expect(manager.getAuthStatus()).resolves.toMatchObject({
      configured: true,
      oauthClientId: 'saved-client',
      callbackUrl: 'http://127.0.0.1:3777/auth/callback',
      runtimePlatform: 'Windows'
    });
  });

  it('refuses to build a login URL when OAuth credentials are missing', async () => {
    const manager = createOAuthManager({
      clientId: '',
      clientSecret: '',
      baseUrl: 'http://127.0.0.1:3777',
      fetch: vi.fn(),
      settings: {
        get: async () => null,
        set: async () => undefined
      },
      tokenStore: {
        getRefreshToken: async () => null,
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    await expect(manager.createAuthorizationUrl()).rejects.toThrow(/填写 Bangumi App ID/);
  });

  it('rejects callback state mismatches before exchanging a code', async () => {
    const fetch = vi.fn();
    const manager = createOAuthManager({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'http://127.0.0.1:3777',
      randomState: () => 'unused',
      fetch,
      settings: {
        get: async () => 'expected-state',
        set: async () => undefined
      },
      tokenStore: {
        getRefreshToken: async () => null,
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    await expect(manager.handleCallback('code-1', 'wrong-state')).rejects.toMatchObject({
      message: 'Bangumi 登录链接已失效，请重新登录',
      statusCode: 400,
      expose: true
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a readable error when Bangumi rejects an authorization code', async () => {
    const manager = createOAuthManager({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'http://127.0.0.1:3777',
      fetch: vi.fn(async () => ({ ok: false, status: 400 })),
      settings: {
        get: async (key) => key === 'oauth_state' ? 'state-ok' : null,
        set: async () => undefined
      },
      tokenStore: {
        getRefreshToken: async () => null,
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    await expect(manager.handleCallback('expired-code', 'state-ok')).rejects.toMatchObject({
      message: 'Bangumi 授权已失效，请重新登录',
      statusCode: 400,
      expose: true
    });
  });

  it('refreshes expired access tokens and stores the rotated refresh token', async () => {
    const settings = new Map<string, string>([
      ['access_token', 'old-access'],
      ['access_token_expires_at', String(Date.now() - 1000)]
    ]);
    let refreshToken = 'old-refresh';
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 604800,
        token_type: 'Bearer'
      })
    }));
    const manager = createOAuthManager({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'http://127.0.0.1:3777',
      randomState: () => 'unused',
      fetch,
      settings: {
        get: async (key) => settings.get(key) ?? null,
        set: async (key, value) => settings.set(key, value)
      },
      tokenStore: {
        getRefreshToken: async () => refreshToken,
        setRefreshToken: async (value) => {
          refreshToken = value;
        },
        deleteRefreshToken: async () => undefined
      }
    });

    await expect(manager.getAccessToken()).resolves.toBe('new-access');
    expect(refreshToken).toBe('new-refresh');
    expect(settings.get('access_token')).toBe('new-access');
    expect(fetch).toHaveBeenCalledWith(
      'https://bgm.tv/oauth/access_token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('shares an in-flight refresh and retries after a failed refresh', async () => {
    const settings = new Map<string, string>([['access_token_expires_at', '0']]);
    let refreshToken = 'old-refresh';
    let attempts = 0;
    const fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) return new Response(null, { status: 503 });
      return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
    });
    const manager = createOAuthManager({
      clientId: 'client-id', clientSecret: 'client-secret', baseUrl: 'http://127.0.0.1:3777', fetch,
      settings: {
        get: async (key) => settings.get(key) ?? null,
        set: async (key, value) => { settings.set(key, value); }
      },
      tokenStore: {
        getRefreshToken: async () => refreshToken,
        setRefreshToken: async (value) => { refreshToken = value; },
        deleteRefreshToken: async () => undefined
      }
    });

    const failed = await Promise.allSettled(Array.from({ length: 3 }, () => manager.getAccessToken()));
    expect(failed.every((result) => result.status === 'rejected')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await Promise.all(Array.from({ length: 3 }, () => manager.getAccessToken()))).toEqual([
      'new-access', 'new-access', 'new-access'
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refreshToken).toBe('new-refresh');
  });

  it('aborts a stalled token exchange with a readable error', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const manager = createOAuthManager({
      clientId: 'client-id', clientSecret: 'client-secret', baseUrl: 'http://127.0.0.1:3777', fetch,
      settings: { get: async () => null, set: async () => undefined },
      tokenStore: {
        getRefreshToken: async () => 'old-refresh',
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    try {
      const pending = manager.getAccessToken();
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
      await expect(pending).rejects.toMatchObject({ statusCode: 502, expose: true, message: expect.stringContaining('超时') });
      expect(timeout).toHaveBeenCalledWith(15_000);
    } finally {
      timeout.mockRestore();
    }
  });

  it('does not report an expired access token as logged in without a refresh token', async () => {
    const settings = new Map<string, string>([
      ['username', 'sai'],
      ['access_token', 'old-access'],
      ['access_token_expires_at', String(Date.now() - 1000)]
    ]);
    const manager = createOAuthManager({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'http://127.0.0.1:3777',
      settings: {
        get: async (key) => settings.get(key) ?? null,
        set: async (key, value) => settings.set(key, value)
      },
      tokenStore: {
        getRefreshToken: async () => null,
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    await expect(manager.getAuthStatus()).resolves.toMatchObject({ authenticated: false });
    settings.set('access_token_expires_at', String(Date.now() + 60_000));
    await expect(manager.getAuthStatus()).resolves.toMatchObject({ authenticated: true });
  });

  it('clears OAuth state after a successful callback', async () => {
    const settings = new Map<string, string>([['oauth_state', 'state-ok']]);
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 604800,
        token_type: 'Bearer'
      })
    }));
    const manager = createOAuthManager({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'http://127.0.0.1:3777',
      randomState: () => 'unused',
      fetch,
      settings: {
        get: async (key) => settings.get(key) ?? null,
        set: async (key, value) => settings.set(key, value)
      },
      tokenStore: {
        getRefreshToken: async () => null,
        setRefreshToken: async () => undefined,
        deleteRefreshToken: async () => undefined
      }
    });

    await manager.handleCallback('code-1', 'state-ok');

    expect(settings.get('oauth_state')).toBe('');
  });
});

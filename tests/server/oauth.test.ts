import { describe, expect, it, vi } from 'vitest';
import { createOAuthManager } from '../../src/server/oauth.js';

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

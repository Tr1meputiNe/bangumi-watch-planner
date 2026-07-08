import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';

describe('HTTP API', () => {
  it('returns auth status and dashboard data', async () => {
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn(async () => ({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: '2026-07-08T20:00:00+08:00'
        }))
      },
      dashboard: {
        getDashboard: vi.fn(async () => ({
          pendingEpisodes: [],
          subjects: [],
          lastSyncAt: '2026-07-08T20:00:00+08:00',
          lastError: null
        })),
        syncNow: vi.fn(),
        markEpisodeWatched: vi.fn(),
        dismissEpisode: vi.fn()
      },
      settings: {
        saveOAuthConfig: vi.fn()
      },
      staticRoot: null,
      apiToken: 'test-token'
    });

    const authResponse = await app.inject({ method: 'GET', url: '/api/auth/status' });
    const dashboardResponse = await app.inject({ method: 'GET', url: '/api/dashboard' });

    expect(authResponse.json()).toEqual({
      authenticated: true,
      username: 'sai',
      nickname: 'Sai',
      lastSyncAt: '2026-07-08T20:00:00+08:00',
      apiToken: 'test-token'
    });
    expect(dashboardResponse.json()).toEqual({
      pendingEpisodes: [],
      subjects: [],
      lastSyncAt: '2026-07-08T20:00:00+08:00',
      lastError: null
    });

    await app.close();
  });

  it('marks one episode watched through the dashboard service', async () => {
    const markEpisodeWatched = vi.fn(async () => undefined);
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      dashboard: {
        getDashboard: vi.fn(),
        syncNow: vi.fn(),
        markEpisodeWatched,
        dismissEpisode: vi.fn()
      },
      settings: {
        saveOAuthConfig: vi.fn()
      },
      staticRoot: null,
      apiToken: 'test-token'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/episodes/42/watched',
      headers: { 'x-bwp-token': 'test-token' }
    });

    expect(response.statusCode).toBe(204);
    expect(markEpisodeWatched).toHaveBeenCalledWith(42);

    await app.close();
  });

  it('saves Bangumi OAuth config through a protected local API', async () => {
    const saveOAuthConfig = vi.fn(async () => undefined);
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      dashboard: {
        getDashboard: vi.fn(),
        syncNow: vi.fn(),
        markEpisodeWatched: vi.fn(),
        dismissEpisode: vi.fn()
      },
      settings: { saveOAuthConfig },
      staticRoot: null,
      apiToken: 'secret-token'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/oauth',
      headers: { 'x-bwp-token': 'secret-token' },
      payload: { clientId: 'client-id', clientSecret: 'client-secret' }
    });

    expect(response.statusCode).toBe(204);
    expect(saveOAuthConfig).toHaveBeenCalledWith({ clientId: 'client-id', clientSecret: 'client-secret' });

    await app.close();
  });

  it('loads the Bangumi user and starts a sync after OAuth callback', async () => {
    const handleCallback = vi.fn(async () => undefined);
    const afterOAuthUserLoaded = vi.fn(async () => undefined);
    const syncNow = vi.fn(async () => ({ subjectsSynced: 1, episodesSynced: 2 }));
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback,
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      dashboard: {
        getDashboard: vi.fn(),
        syncNow,
        markEpisodeWatched: vi.fn(),
        dismissEpisode: vi.fn()
      },
      settings: {
        saveOAuthConfig: vi.fn()
      },
      staticRoot: null,
      apiToken: 'secret-token',
      afterOAuthUserLoaded
    });

    const response = await app.inject({ method: 'GET', url: '/auth/callback?code=code-1&state=state-1' });

    expect(response.statusCode).toBe(302);
    expect(handleCallback).toHaveBeenCalledWith('code-1', 'state-1');
    expect(afterOAuthUserLoaded).toHaveBeenCalled();
    expect(syncNow).toHaveBeenCalled();

    await app.close();
  });

  it('rejects state-changing API requests without the local API token', async () => {
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      dashboard: {
        getDashboard: vi.fn(),
        syncNow: vi.fn(),
        markEpisodeWatched: vi.fn(),
        dismissEpisode: vi.fn()
      },
      settings: {
        saveOAuthConfig: vi.fn()
      },
      staticRoot: null,
      apiToken: 'secret-token'
    });

    const response = await app.inject({ method: 'POST', url: '/api/sync' });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('returns 400 for invalid episode ids', async () => {
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      dashboard: {
        getDashboard: vi.fn(),
        syncNow: vi.fn(),
        markEpisodeWatched: vi.fn(),
        dismissEpisode: vi.fn()
      },
      settings: {
        saveOAuthConfig: vi.fn()
      },
      staticRoot: null,
      apiToken: 'secret-token'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/episodes/not-a-number/watched',
      headers: { 'x-bwp-token': 'secret-token' }
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('returns JSON 404 for unknown API paths', async () => {
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      dashboard: {
        getDashboard: vi.fn(),
        syncNow: vi.fn(),
        markEpisodeWatched: vi.fn(),
        dismissEpisode: vi.fn()
      },
      settings: {
        saveOAuthConfig: vi.fn()
      },
      staticRoot: null,
      apiToken: 'secret-token'
    });

    const response = await app.inject({ method: 'GET', url: '/api/typo' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');

    await app.close();
  });
});

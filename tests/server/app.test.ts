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

  it('returns Bangumi calendar data', async () => {
    const getCalendar = vi.fn(async () => [
      {
        weekday: { en: 'Thu', cn: '星期四', ja: '木耀日', id: 4 },
        items: [
          {
            id: 456,
            name: 'Calendar Anime',
            nameCn: '测试放送',
            url: 'https://bgm.tv/subject/456',
            airDate: '2026-07-09',
            airWeekday: 4,
            image: null,
            ratingScore: 7.2,
            rank: 1234,
            collectionDoing: 321
          }
        ]
      }
    ]);
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      dashboard: {
        getDashboard: vi.fn(),
        getCalendar,
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

    const response = await app.inject({ method: 'GET', url: '/api/calendar' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        weekday: { en: 'Thu', cn: '星期四', ja: '木耀日', id: 4 },
        items: [
          {
            id: 456,
            name: 'Calendar Anime',
            nameCn: '测试放送',
            url: 'https://bgm.tv/subject/456',
            airDate: '2026-07-09',
            airWeekday: 4,
            image: null,
            ratingScore: 7.2,
            rank: 1234,
            collectionDoing: 321
          }
        ]
      }
    ]);
    expect(getCalendar).toHaveBeenCalled();

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

  it('marks one episode unwatched through the dashboard service', async () => {
    const markEpisodeUnwatched = vi.fn(async () => undefined);
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
        markEpisodeUnwatched,
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
      url: '/api/episodes/42/unwatched',
      headers: { 'x-bwp-token': 'test-token' }
    });

    expect(response.statusCode).toBe(204);
    expect(markEpisodeUnwatched).toHaveBeenCalledWith(42);

    await app.close();
  });

  it('marks all episodes through a selected episode', async () => {
    const markSubjectEpisodesWatchedThrough = vi.fn(async () => undefined);
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
        markSubjectEpisodesWatchedThrough,
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
      url: '/api/subjects/7/watched-through',
      headers: { 'x-bwp-token': 'test-token' },
      payload: { episodeId: 42 }
    });

    expect(response.statusCode).toBe(204);
    expect(markSubjectEpisodesWatchedThrough).toHaveBeenCalledWith(7, 42);

    await app.close();
  });

  it('adds an anime subject to the watching collection', async () => {
    const addSubjectToWatching = vi.fn(async () => ({ subjectsSynced: 1, episodesSynced: 12 }));
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
        addSubjectToWatching,
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
      url: '/api/subjects/456/watching',
      headers: { 'x-bwp-token': 'test-token' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ subjectsSynced: 1, episodesSynced: 12 });
    expect(addSubjectToWatching).toHaveBeenCalledWith(456);

    await app.close();
  });

  it('searches anime subjects by keyword', async () => {
    const searchAnimeSubjects = vi.fn(async () => [
      {
        id: 456,
        name: 'Test Anime',
        nameCn: '测试动画',
        eps: 12,
        image: null,
        url: 'https://bgm.tv/subject/456'
      }
    ]);
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
        searchAnimeSubjects,
        dismissEpisode: vi.fn()
      },
      settings: {
        saveOAuthConfig: vi.fn()
      },
      staticRoot: null,
      apiToken: 'test-token'
    });

    const response = await app.inject({ method: 'GET', url: '/api/search/anime?q=%E6%B5%8B%E8%AF%95' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [
        {
          id: 456,
          name: 'Test Anime',
          nameCn: '测试动画',
          eps: 12,
          image: null,
          url: 'https://bgm.tv/subject/456'
        }
      ]
    });
    expect(searchAnimeSubjects).toHaveBeenCalledWith('测试');

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

  it('exposes safe sync error messages instead of a generic server error', async () => {
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      dashboard: {
        getDashboard: vi.fn(),
        syncNow: vi.fn(async () => {
          throw Object.assign(new Error('Bangumi 同步暂时失败，请稍后再试'), { statusCode: 502, expose: true });
        }),
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
      url: '/api/sync',
      headers: { 'x-bwp-token': 'secret-token' }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Bangumi 同步暂时失败，请稍后再试' });

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

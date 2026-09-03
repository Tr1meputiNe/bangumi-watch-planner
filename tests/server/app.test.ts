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
      lastSyncAt: '2026-07-08T20:00:00+08:00'
    });
    expect(authResponse.headers['set-cookie']).toContain('bwp_token=test-token');
    expect(authResponse.headers['set-cookie']).toContain('HttpOnly');
    expect(authResponse.headers['set-cookie']).toContain('SameSite=Strict');
    expect(dashboardResponse.json()).toEqual({
      pendingEpisodes: [],
      subjects: [],
      lastSyncAt: '2026-07-08T20:00:00+08:00',
      lastError: null
    });

    await app.close();
  });

  it('does not expose internal server errors to the browser', async () => {
    const app = testApp({
      getDashboard: vi.fn(async () => {
        throw new Error('database details must stay private');
      })
    });

    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: '服务器处理失败，请稍后重试' });
    expect(response.body).not.toContain('database details');
    expect(response.body).not.toContain('Internal server error');
    await app.close();
  });

  it('returns one subject episode grid on demand', async () => {
    const episodes = [{
      id: 11,
      subjectId: 7,
      subjectName: 'Test Anime',
      subjectNameCn: '测试番剧',
      subjectUrl: 'https://bgm.tv/subject/7',
      episodeType: 0,
      sort: 1,
      ep: 1,
      name: 'first',
      nameCn: '第一集',
      airdate: '2026-07-01',
      airTime: '20:00',
      collectionType: 0,
      dismissedAt: null,
      snoozedUntil: null
    }];
    const getSubjectEpisodes = vi.fn(async () => episodes);
    const app = testApp({ getSubjectEpisodes });

    const response = await app.inject({ method: 'GET', url: '/api/subjects/7/episodes' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ episodes });
    expect(getSubjectEpisodes).toHaveBeenCalledWith(7);
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

  it('validates, saves, and removes a local broadcast correction', async () => {
    const saveBroadcastOverride = vi.fn(async () => undefined);
    const deleteBroadcastOverride = vi.fn(async () => undefined);
    const app = testApp({ saveBroadcastOverride, deleteBroadcastOverride });
    const headers = { 'x-bwp-token': 'test-token', 'content-type': 'application/json' };

    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/broadcast-overrides/456',
      headers,
      payload: { airDate: '2026-02-30', airTime: '25:00', dateShiftDays: 1.5 }
    });
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/broadcast-overrides/456',
      headers,
      payload: { airDate: '2026-07-19', airTime: '01:30', dateShiftDays: 1 }
    });
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/broadcast-overrides/456',
      headers: { 'x-bwp-token': 'test-token' }
    });

    expect(invalid.statusCode).toBe(400);
    expect(saved.statusCode).toBe(204);
    expect(removed.statusCode).toBe(204);
    expect(saveBroadcastOverride).toHaveBeenCalledWith({
      subjectId: 456,
      airDate: '2026-07-19',
      airTime: '01:30',
      dateShiftDays: 1
    });
    expect(deleteBroadcastOverride).toHaveBeenCalledWith(456);
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

  it('snoozes one seasonal reminder until tomorrow', async () => {
    const snoozeEpisodeUntilTomorrow = vi.fn(async () => undefined);
    const app = testApp({ snoozeEpisodeUntilTomorrow });

    const response = await app.inject({
      method: 'POST',
      url: '/api/reminders/42/tomorrow',
      headers: { 'x-bwp-token': 'test-token' }
    });

    expect(response.statusCode).toBe(204);
    expect(snoozeEpisodeUntilTomorrow).toHaveBeenCalledWith(42);

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
    const addSubjectToWatching = vi.fn(async () => ({
      state: 'running',
      startedAt: '2026-07-30T12:00:00.000Z',
      completedAt: null,
      error: null,
      processedSubjects: 0,
      totalSubjects: 0,
      result: null
    }));
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

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(expect.objectContaining({ state: 'running' }));
    expect(addSubjectToWatching).toHaveBeenCalledWith(456);

    await app.close();
  });

  it('adds an anime subject to the wishlist collection', async () => {
    const addSubjectToWishlist = vi.fn(async () => ({
      state: 'running',
      startedAt: '2026-07-30T12:00:00.000Z',
      completedAt: null,
      error: null,
      processedSubjects: 0,
      totalSubjects: 0,
      result: null
    }));
    const app = testApp({ addSubjectToWishlist });

    const response = await app.inject({
      method: 'POST',
      url: '/api/subjects/456/wishlist',
      headers: { 'x-bwp-token': 'test-token' }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(expect.objectContaining({ state: 'running' }));
    expect(addSubjectToWishlist).toHaveBeenCalledWith(456);

    await app.close();
  });

  it('searches anime subjects by keyword', async () => {
    const searchAnimeSubjects = vi.fn(async () => [
      {
        id: 456,
        name: 'Test Anime',
        nameCn: '测试动画',
        airDate: '2026-07-01',
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
          airDate: '2026-07-01',
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

  it('redirects after OAuth callback and starts sync in the background', async () => {
    const handleCallback = vi.fn(async () => undefined);
    const afterOAuthUserLoaded = vi.fn(async () => undefined);
    const syncNow = vi.fn();
    const startSync = vi.fn(() => ({
      state: 'running' as const,
      startedAt: '2026-07-30T12:00:00.000Z',
      completedAt: null,
      error: null,
      processedSubjects: 0,
      totalSubjects: 0,
      result: null
    }));
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
        startSync,
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
    expect(startSync).toHaveBeenCalledOnce();
    expect(syncNow).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns an already authenticated user home after a stale OAuth callback', async () => {
    const startSync = vi.fn();
    const app = buildApp({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(async () => {
          throw Object.assign(new Error('Bangumi 登录链接已失效，请重新登录'), {
            statusCode: 400,
            expose: true
          });
        }),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn(async () => ({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: null
        }))
      },
      dashboard: {
        getDashboard: vi.fn(),
        syncNow: vi.fn(),
        startSync,
        markEpisodeWatched: vi.fn(),
        dismissEpisode: vi.fn()
      },
      staticRoot: null
    });

    const response = await app.inject({ method: 'GET', url: '/auth/callback?code=old-code&state=old-state' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(startSync).not.toHaveBeenCalled();

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

  it('starts manual sync without waiting and exposes its status', async () => {
    const runningStatus = {
      state: 'running' as const,
      startedAt: '2026-07-30T12:00:00.000Z',
      completedAt: null,
      error: null,
      processedSubjects: 0,
      totalSubjects: 3,
      result: null
    };
    const startSync = vi.fn(() => runningStatus);
    const getSyncStatus = vi.fn(() => runningStatus);
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
        startSync,
        getSyncStatus,
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
      headers: { cookie: 'bwp_token=secret-token' }
    });
    const statusResponse = await app.inject({ method: 'GET', url: '/api/sync/status' });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(runningStatus);
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual(runningStatus);
    expect(startSync).toHaveBeenCalledOnce();
    expect(getSyncStatus).toHaveBeenCalledOnce();

    await app.close();
  });

  it('starts a full calibration and retries a failed durable operation', async () => {
    const idleStatus = {
      state: 'idle' as const,
      startedAt: null,
      completedAt: null,
      error: null,
      processedSubjects: 0,
      totalSubjects: 0,
      result: null
    };
    const startSync = vi.fn(() => idleStatus);
    const retryOperation = vi.fn(async () => undefined);
    const app = testApp({ startSync, retryOperation });
    const headers = { cookie: 'bwp_token=test-token' };

    const calibration = await app.inject({ method: 'POST', url: '/api/sync/full', headers });
    const retry = await app.inject({ method: 'POST', url: '/api/operations/7/retry', headers });

    expect(calibration.statusCode).toBe(202);
    expect(retry.statusCode).toBe(202);
    expect(startSync).toHaveBeenCalledWith('full');
    expect(retryOperation).toHaveBeenCalledWith(7);
    await app.close();
  });

  it('requires the local session cookie before opening the event stream', async () => {
    const subscribe = vi.fn();
    const app = testApp({ subscribe });

    const response = await app.inject({ method: 'GET', url: '/api/events' });

    expect(response.statusCode).toBe(403);
    expect(subscribe).not.toHaveBeenCalled();
    await app.close();
  });

  it('exposes a failed background sync through the status endpoint', async () => {
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
        getSyncStatus: vi.fn(() => ({
          state: 'error',
          startedAt: '2026-07-30T12:00:00.000Z',
          completedAt: '2026-07-30T12:00:05.000Z',
          error: 'Bangumi 同步暂时失败，请稍后再试',
          processedSubjects: 0,
          totalSubjects: 0,
          result: null
        })),
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
      method: 'GET',
      url: '/api/sync/status'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: 'error',
      error: 'Bangumi 同步暂时失败，请稍后再试'
    });

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

  it('serves backlog, held, and strictly filtered wishlist reads without a write token', async () => {
    const getBacklog = vi.fn(async () => ({
      today: '2026-07-19',
      todayTasks: [],
      futureDays: [],
      active: [],
      held: [],
      completed: [],
      estimatedCompletionDate: null
    }));
    const getWishlist = vi.fn(async () => ({ items: [], years: [2024] }));
    const getHeldSubjects = vi.fn(async () => []);
    const app = testApp({ getBacklog, getHeldSubjects, getWishlist });

    const backlog = await app.inject({ method: 'GET', url: '/api/backlog' });
    const held = await app.inject({ method: 'GET', url: '/api/held' });
    const knownYear = await app.inject({ method: 'GET', url: '/api/wishlist?q=title&year=2024' });
    const unknownYear = await app.inject({ method: 'GET', url: '/api/wishlist?q=title&year=unknown' });
    const allYears = await app.inject({ method: 'GET', url: '/api/wishlist?year=all' });

    expect(backlog.statusCode).toBe(200);
    expect(held.statusCode).toBe(200);
    expect(backlog.json()).toMatchObject({ today: '2026-07-19' });
    expect(knownYear.statusCode).toBe(200);
    expect(unknownYear.statusCode).toBe(200);
    expect(allYears.statusCode).toBe(200);
    expect(getBacklog).toHaveBeenCalledOnce();
    expect(getHeldSubjects).toHaveBeenCalledOnce();
    expect(getWishlist.mock.calls).toEqual([
      ['title', 2024],
      ['title', 'unknown'],
      ['', null]
    ]);

    await app.close();
  });

  it('serves the upcoming Yuc season and queues a confirmed subject with the write token', async () => {
    const getUpcomingSeason = vi.fn(async () => ({ seasonKey: '2026Q4', available: true, items: [] }));
    const addUpcomingToWishlist = vi.fn(async () => ({
      state: 'running' as const,
      startedAt: '2026-08-31T12:00:00.000Z',
      completedAt: null,
      error: null,
      processedSubjects: 0,
      totalSubjects: 0,
      result: null
    }));
    const app = testApp({ getUpcomingSeason, addUpcomingToWishlist });

    const read = await app.inject({ method: 'GET', url: '/api/upcoming-season' });
    const write = await app.inject({
      method: 'POST',
      url: '/api/upcoming-season/501/wishlist',
      headers: { 'x-bwp-token': 'test-token' }
    });

    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ seasonKey: '2026Q4', available: true, items: [] });
    expect(write.statusCode).toBe(202);
    expect(addUpcomingToWishlist).toHaveBeenCalledWith(501);
    await app.close();
  });

  it.each(['202', '20240', '20x4'])('returns 400 for invalid wishlist year %j', async (year) => {
    const app = testApp();

    const response = await app.inject({ method: 'GET', url: `/api/wishlist?year=${encodeURIComponent(year)}` });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('routes every subject and backlog action with parsed positive ids and expected response codes', async () => {
    const startSubject = vi.fn(async () => ({
      state: 'running',
      startedAt: '2026-07-30T12:00:00.000Z',
      completedAt: null,
      error: null,
      processedSubjects: 0,
      totalSubjects: 0,
      result: null
    }));
    const pauseBacklogSubject = vi.fn(async () => undefined);
    const resumeBacklogSubject = vi.fn(async () => undefined);
    const holdSubject = vi.fn(async () => undefined);
    const resumeHeldSubject = vi.fn(async () => undefined);
    const dropSubject = vi.fn(async () => undefined);
    const completeBacklogSubject = vi.fn(async () => undefined);
    const swapBacklogTask = vi.fn(async () => undefined);
    const skipBacklogToday = vi.fn(async () => undefined);
    const replanBacklogToday = vi.fn(async () => undefined);
    const app = testApp({
      startSubject,
      holdSubject,
      resumeHeldSubject,
      dropSubject,
      pauseBacklogSubject,
      resumeBacklogSubject,
      completeBacklogSubject,
      swapBacklogTask,
      skipBacklogToday,
      replanBacklogToday
    });
    const headers = { 'x-bwp-token': 'test-token' };

    const start = await app.inject({ method: 'POST', url: '/api/subjects/101/start', headers });
    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/api/subjects/101/hold', headers }),
      app.inject({ method: 'POST', url: '/api/subjects/101/resume', headers }),
      app.inject({ method: 'POST', url: '/api/subjects/101/drop', headers }),
      app.inject({ method: 'POST', url: '/api/backlog/101/pause', headers }),
      app.inject({ method: 'POST', url: '/api/backlog/101/resume', headers }),
      app.inject({ method: 'POST', url: '/api/backlog/101/complete', headers }),
      app.inject({ method: 'POST', url: '/api/backlog/tasks/501/swap', headers }),
      app.inject({ method: 'POST', url: '/api/backlog/today/skip', headers }),
      app.inject({ method: 'POST', url: '/api/backlog/today/replan', headers })
    ]);

    expect(start.statusCode).toBe(202);
    expect(start.json()).toEqual(expect.objectContaining({ state: 'running' }));
    expect(responses.map((response) => response.statusCode)).toEqual([204, 204, 204, 204, 204, 204, 204, 204, 204]);
    expect(startSubject).toHaveBeenCalledWith(101);
    expect(holdSubject).toHaveBeenCalledWith(101);
    expect(resumeHeldSubject).toHaveBeenCalledWith(101);
    expect(dropSubject).toHaveBeenCalledWith(101);
    expect(pauseBacklogSubject).toHaveBeenCalledWith(101);
    expect(resumeBacklogSubject).toHaveBeenCalledWith(101);
    expect(completeBacklogSubject).toHaveBeenCalledWith(101);
    expect(swapBacklogTask).toHaveBeenCalledWith(501);
    expect(skipBacklogToday).toHaveBeenCalledOnce();
    expect(replanBacklogToday).toHaveBeenCalledOnce();

    await app.close();
  });

  it.each([
    '/api/subjects/0/start',
    '/api/subjects/01/start',
    '/api/subjects/0/hold',
    '/api/subjects/-1/resume',
    '/api/subjects/1.5/drop',
    '/api/backlog/-1/pause',
    '/api/backlog/1.5/resume',
    '/api/backlog/9007199254740992/complete',
    '/api/backlog/tasks/not-an-id/swap'
  ])('rejects a non-canonical positive id at %s', async (url) => {
    const app = testApp();

    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-bwp-token': 'test-token' }
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it.each([
    '/api/subjects/101/start',
    '/api/subjects/101/hold',
    '/api/subjects/101/resume',
    '/api/subjects/101/drop',
    '/api/backlog/101/pause',
    '/api/backlog/101/resume',
    '/api/backlog/101/complete',
    '/api/backlog/tasks/501/swap',
    '/api/backlog/today/skip',
    '/api/backlog/today/replan',
    '/api/reminders/501/tomorrow'
  ])('protects planner write route %s with the local token', async (url) => {
    const app = testApp();

    const response = await app.inject({ method: 'POST', url });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

function testApp(dashboardOverrides: Record<string, unknown> = {}) {
  return buildApp({
    auth: {
      createAuthorizationUrl: vi.fn(),
      handleCallback: vi.fn(),
      getAccessToken: vi.fn(),
      getAuthStatus: vi.fn()
    },
    dashboard: {
      getDashboard: vi.fn(),
      getSubjectEpisodes: vi.fn(),
      getBacklog: vi.fn(),
      getHeldSubjects: vi.fn(),
      getWishlist: vi.fn(),
      getCalendar: vi.fn(),
      getUpcomingSeason: vi.fn(),
      saveBroadcastOverride: vi.fn(),
      deleteBroadcastOverride: vi.fn(),
      syncNow: vi.fn(),
      markEpisodeWatched: vi.fn(),
      markEpisodeUnwatched: vi.fn(),
      markSubjectEpisodesWatchedThrough: vi.fn(),
      addSubjectToWatching: vi.fn(),
      addSubjectToWishlist: vi.fn(),
      addUpcomingToWishlist: vi.fn(),
      startSubject: vi.fn(),
      holdSubject: vi.fn(),
      resumeHeldSubject: vi.fn(),
      dropSubject: vi.fn(),
      pauseBacklogSubject: vi.fn(),
      resumeBacklogSubject: vi.fn(),
      completeBacklogSubject: vi.fn(),
      swapBacklogTask: vi.fn(),
      skipBacklogToday: vi.fn(),
      replanBacklogToday: vi.fn(),
      searchAnimeSubjects: vi.fn(),
      dismissEpisode: vi.fn(),
      snoozeEpisodeUntilTomorrow: vi.fn(),
      ...dashboardOverrides
    },
    settings: { saveOAuthConfig: vi.fn() },
    staticRoot: null,
    apiToken: 'test-token'
  });
}

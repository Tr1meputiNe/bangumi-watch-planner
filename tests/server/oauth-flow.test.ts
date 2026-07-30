import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { createBangumiClient } from '../../src/server/bangumi-client.js';
import { createDashboardService } from '../../src/server/dashboard.js';
import { createRepository } from '../../src/server/db.js';
import { createOAuthManager } from '../../src/server/oauth.js';

describe('OAuth callback to backlog planner flow', () => {
  let cleanup = () => undefined;

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
  });

  it('keeps seasonal, backlog, wishlist, held, completed, and reopened states consistent', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'bwp-oauth-flow-'));
    const dbPath = join(tempDir, 'app.sqlite');
    const repository = createRepository(dbPath);
    cleanup = () => {
      repository.close();
      rmSync(tempDir, { recursive: true, force: true });
    };
    const collectionUrls: string[] = [];
    const subjectWrites: Array<{ subjectId: number; type: number }> = [];
    const episodeWrites: Array<{ subjectId: number; episodeIds: number[]; type: number }> = [];
    const collectionTypes = new Map<number, 1 | 2 | 3 | 4>([[123, 3], [124, 3], [201, 1]]);
    const episodeStatuses = new Map<number, number>([[456, 0], [1241, 0], [1242, 0], [2011, 0], [2012, 0]]);
    let refreshToken: string | null = null;

    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === 'https://bgm.tv/oauth/access_token') {
        return Response.json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 604800,
          token_type: 'Bearer'
        });
      }

      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer access-token' }));

      if (url === 'https://api.bgm.tv/v0/me') {
        return Response.json({ id: 1, username: 'alice', nickname: 'Alice' });
      }

      if (url.startsWith('https://api.bgm.tv/v0/users/alice/collections?')) {
        collectionUrls.push(url);
        const type = Number(new URL(url).searchParams.get('type')) as 1 | 3 | 4;
        const data = [...collectionTypes]
          .filter(([, collectionType]) => collectionType === type)
          .map(([subjectId]) => collection(subjectId, type));
        return Response.json({ total: data.length, data });
      }

      const episodeCollectionMatch = url.match(/^https:\/\/api\.bgm\.tv\/v0\/users\/-\/collections\/(\d+)\/episodes\?limit=1000&offset=0$/);
      if (episodeCollectionMatch && !init?.method) {
        const subjectId = Number(episodeCollectionMatch[1]);
        const data = subjectEpisodes(subjectId).map((item) => ({
          type: episodeStatuses.get(item.id) ?? 0,
          updated_at: 0,
          episode: item
        }));
        return Response.json({ total: data.length, data });
      }

      const subjectWriteMatch = url.match(/^https:\/\/api\.bgm\.tv\/v0\/users\/-\/collections\/(\d+)$/);
      if (subjectWriteMatch && init?.method === 'PATCH') {
        const subjectId = Number(subjectWriteMatch[1]);
        const { type } = JSON.parse(String(init.body)) as { type: 2 | 3 | 4 };
        collectionTypes.set(subjectId, type);
        subjectWrites.push({ subjectId, type });
        return new Response(null, { status: 204 });
      }

      const episodeWriteMatch = url.match(/^https:\/\/api\.bgm\.tv\/v0\/users\/-\/collections\/(\d+)\/episodes$/);
      if (episodeWriteMatch && init?.method === 'PATCH') {
        const subjectId = Number(episodeWriteMatch[1]);
        const body = JSON.parse(String(init.body)) as { episode_id: number[]; type: number };
        for (const episodeId of body.episode_id) episodeStatuses.set(episodeId, body.type);
        episodeWrites.push({ subjectId, episodeIds: body.episode_id, type: body.type });
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected Bangumi request: ${url}`);
    });

    const auth = createOAuthManager({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'http://127.0.0.1:3777',
      randomState: () => 'state-ok',
      fetch,
      settings: {
        get: (key) => repository.getSetting(key),
        set: (key, value) => repository.setSetting(key, value)
      },
      tokenStore: {
        getRefreshToken: async () => refreshToken,
        setRefreshToken: async (value) => { refreshToken = value; },
        deleteRefreshToken: async () => { refreshToken = null; }
      }
    });
    const bangumiClient = createBangumiClient({
      fetch,
      getAccessToken: () => auth.getAccessToken(),
      userAgent: 'bangumi-watch-planner-test'
    });
    const client = {
      ...bangumiClient,
      getBroadcastCatalog: vi.fn(async () => ({
        schedules: new Map(),
        seasonWindow: {
          currentSeasonKey: '2026Q3',
          previousSeasonKey: '2026Q2',
          anchorDate: '2026-07-01',
          overlapThrough: '2026-07-14',
          authoritative: true,
          activeSubjectIds: new Set([123]),
          entries: new Map([[123, {
            subjectId: 123,
            seasonKey: '2026Q3',
            seasonKind: 'new' as const,
            normalPremiereDate: '2026-07-01',
            airTime: '20:00',
            dayOffset: 0
          }]])
        }
      }))
    };
    const dashboard = createDashboardService({
      auth,
      client,
      repository,
      clock: () => new Date('2026-07-19T04:00:00.000Z')
    });
    const app = buildApp({
      auth,
      dashboard,
      staticRoot: null,
      afterOAuthUserLoaded: async () => {
        const me = await client.getMe();
        await repository.setSetting('username', me.username);
        await repository.setSetting('nickname', me.nickname);
      }
    });

    await auth.createAuthorizationUrl();
    const callback = await app.inject({ method: 'GET', url: '/auth/callback?code=code-1&state=state-ok' });
    await vi.waitFor(() => expect(dashboard.getSyncStatus().state).toBe('idle'));
    const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
    const initialDashboard = await getJson(app, '/api/dashboard');
    const initialBacklog = await getJson(app, '/api/backlog');
    const initialWishlist = await getJson(app, '/api/wishlist?year=all');

    expect(callback.statusCode).toBe(302);
    expect(refreshToken).toBe('refresh-token');
    expect(status.json()).toMatchObject({ authenticated: true, username: 'alice', nickname: 'Alice' });
    expect(collectionUrls.slice(0, 3).map((url) => new URL(url).searchParams.get('type'))).toEqual(['1', '3', '4']);
    expect(initialDashboard.subjects.map((subject: { id: number }) => subject.id)).toEqual([123]);
    expect(initialDashboard.pendingEpisodes).toEqual([expect.objectContaining({ id: 456, subjectId: 123 })]);
    expect(initialBacklog.active.map((subject: { id: number }) => subject.id)).toEqual([124]);
    expect(initialBacklog.futureDays.flatMap((day: { tasks: Array<{ subjectId: number }> }) => day.tasks).some((task: { subjectId: number }) => task.subjectId === 124)).toBe(true);
    expect(initialWishlist.items).toEqual([expect.objectContaining({ id: 201, isCurrentSeason: false })]);

    expect((await app.inject({ method: 'POST', url: '/api/subjects/201/start' })).statusCode).toBe(202);
    await vi.waitFor(() => expect(dashboard.getSyncStatus().state).toBe('idle'));
    const startedBacklog = await getJson(app, '/api/backlog');
    expect(startedBacklog.active.map((subject: { id: number }) => subject.id).sort()).toEqual([124, 201]);
    const firstTwoSlotDay = startedBacklog.futureDays.find((day: { tasks: unknown[] }) => day.tasks.length === 2);
    expect(new Set(firstTwoSlotDay.tasks.map((task: { subjectId: number }) => task.subjectId)).size).toBe(2);
    expect((await getJson(app, '/api/wishlist?year=all')).items).toEqual([]);

    expect((await app.inject({ method: 'POST', url: '/api/backlog/today/replan' })).statusCode).toBe(204);
    const plannedToday = await getJson(app, '/api/backlog');
    const watchedTask = plannedToday.todayTasks.find((task: { subjectId: number }) => task.subjectId === 124);
    expect(watchedTask).toBeDefined();
    expect((await app.inject({ method: 'POST', url: `/api/episodes/${watchedTask.episodeId}/watched` })).statusCode).toBe(204);
    const refilledToday = await getJson(app, '/api/backlog');
    expect(refilledToday.todayTasks.some((task: { episodeId: number }) => task.episodeId === watchedTask.episodeId)).toBe(false);
    expect((await repository.getEpisode(watchedTask.episodeId))?.collectionType).toBe(2);

    expect((await app.inject({ method: 'POST', url: '/api/backlog/201/pause' })).statusCode).toBe(204);
    const heldBacklog = await getJson(app, '/api/backlog');
    expect(heldBacklog.held).toEqual([expect.objectContaining({ id: 201 })]);
    expect(heldBacklog.todayTasks.some((task: { subjectId: number }) => task.subjectId === 201)).toBe(false);

    expect((await app.inject({ method: 'POST', url: '/api/backlog/201/resume' })).statusCode).toBe(204);
    expect((await getJson(app, '/api/backlog')).active).toEqual(expect.arrayContaining([expect.objectContaining({ id: 201 })]));

    expect((await app.inject({ method: 'POST', url: '/api/episodes/2011/watched' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/episodes/2012/watched' })).statusCode).toBe(204);
    const completedBacklog = await getJson(app, '/api/backlog');
    expect(completedBacklog.completed).toEqual(expect.arrayContaining([expect.objectContaining({ id: 201, collectionType: 2 })]));
    expect(collectionTypes.get(201)).toBe(2);

    expect((await app.inject({ method: 'POST', url: '/api/episodes/2011/unwatched' })).statusCode).toBe(204);
    const reopenedBacklog = await getJson(app, '/api/backlog');
    expect(reopenedBacklog.active).toEqual(expect.arrayContaining([expect.objectContaining({ id: 201, collectionType: 3 })]));
    expect(reopenedBacklog.futureDays.flatMap((day: { tasks: Array<{ episodeId: number }> }) => day.tasks).some((task: { episodeId: number }) => task.episodeId === 2011)).toBe(true);
    expect(subjectWrites).toEqual(expect.arrayContaining([
      { subjectId: 201, type: 3 },
      { subjectId: 201, type: 4 },
      { subjectId: 201, type: 2 }
    ]));
    expect(episodeWrites).toEqual(expect.arrayContaining([
      { subjectId: 201, episodeIds: [2011], type: 0 }
    ]));

    await app.close();
  });
});

async function getJson(app: ReturnType<typeof buildApp>, url: string) {
  const response = await app.inject({ method: 'GET', url });
  expect(response.statusCode).toBe(200);
  return response.json();
}

function collection(subjectId: number, type: 1 | 3 | 4) {
  const subjects = {
    123: { name: 'Seasonal Anime', nameCn: '本季度新番', eps: 1, date: '2026-07-01' },
    124: { name: 'Old Watching', nameCn: '旧番在看', eps: 2, date: '2020-01-01' },
    201: { name: 'Old Wishlist', nameCn: '旧番想看', eps: 2, date: '2021-01-01' }
  } as const;
  const subject = subjects[subjectId as keyof typeof subjects];
  return {
    subject_id: subjectId,
    type,
    ep_status: 0,
    subject: {
      id: subjectId,
      name: subject.name,
      name_cn: subject.nameCn,
      date: subject.date,
      eps: subject.eps,
      images: {}
    }
  };
}

function subjectEpisodes(subjectId: number) {
  if (subjectId === 123) return [episode(456, 123, 1, '2026-07-19')];
  if (subjectId === 124) return [episode(1241, 124, 1, '2020-01-01'), episode(1242, 124, 2, '2020-01-08')];
  if (subjectId === 201) return [episode(2011, 201, 1, '2021-01-01'), episode(2012, 201, 2, '2021-01-08')];
  return [];
}

function episode(id: number, subjectId: number, number: number, airdate: string) {
  return {
    id,
    subject_id: subjectId,
    type: 0,
    sort: number,
    ep: number,
    name: `Episode ${number}`,
    name_cn: `第 ${number} 集`,
    airdate
  };
}

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepository, type Repository } from '../../src/server/db.js';
import { createDashboardService } from '../../src/server/dashboard.js';
import { syncAnimeCollections } from '../../src/server/sync.js';
import type { BangumiClient, EpisodeRow, OAuthManager, SubjectWrite } from '../../src/server/types.js';

const watchedAt = '2026-11-05T12:00:00.000Z';
const auth = { getAuthStatus: async () => ({ authenticated: true, username: 'test', nickname: null, lastSyncAt: null }) } as OAuthManager;

describe('free backlog', () => {
  let directory: string;
  let repository: Repository;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bwp-free-backlog-'));
    repository = createRepository(join(directory, 'app.sqlite'));
  });
  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('ignores legacy tasks and only returns the six most recently watched active titles', async () => {
    for (let id = 1; id <= 10; id += 1) {
      await repository.upsertSubject(subject(id));
      await repository.replaceSubjectEpisodes(id, [episode(id)]);
      if (id < 10) await repository.setSubjectLastWatchedAt(id, `2026-11-0${id}T00:00:00.000Z`);
    }
    await repository.setSubjectState(9, { collectionType: 4, plannerMode: 'backlog', completedAt: null });
    await repository.setSubjectState(8, { collectionType: 2, plannerMode: 'backlog', completedAt: watchedAt });
    await repository.replaceBacklogTasks({
      fromDate: '2026-11-05', throughDate: '2026-11-05', preserveLocked: false,
      tasks: [{ subjectId: 1, episodeId: 10, plannedDate: '2026-11-05', slot: 0, locked: true }]
    });
    const service = createDashboardService({ auth, client: client(), repository, clock: () => new Date(watchedAt) });

    const data = await service.getBacklog();

    expect(data.recent?.map((item) => item.id)).toEqual([7, 6, 5, 4, 3, 2]);
    expect(data.active.map((item) => item.id)).toContain(10);
    expect(data.todayTasks).toEqual([]);
    expect(data.futureDays).toEqual([]);
    expect(data.estimatedCompletionDate).toBeNull();
  });

  it('persists a real watch time without promoting metadata, undo, or collection edits', async () => {
    await repository.upsertSubject(subject(1));
    await repository.replaceSubjectEpisodes(1, [episode(1)]);
    const service = createDashboardService({
      auth, client: client(),
      repository: { ...repository, enqueueOperation: undefined } as unknown as Repository,
      clock: () => new Date(watchedAt)
    });

    await service.markEpisodeWatched(10);
    await repository.upsertSubject({ ...subject(1), nameCn: '修改名称', epStatus: 1 });
    await service.holdSubject(1);
    await service.resumeHeldSubject(1);
    await service.markEpisodeUnwatched(10);

    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(watchedAt);
    repository.close();
    repository = createRepository(join(directory, 'app.sqlite'));
    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(watchedAt);
    expect(await repository.listBacklogTasks('2026-11-05', '2026-11-12')).toEqual([]);
  });

  it('does not create a watch time when a remote watch write fails', async () => {
    await repository.upsertSubject(subject(1));
    await repository.replaceSubjectEpisodes(1, [episode(1)]);
    const service = createDashboardService({
      auth, client: client({ markEpisodesWatched: async () => { throw new Error('offline'); } }),
      repository: { ...repository, enqueueOperation: undefined } as unknown as Repository,
      clock: () => new Date(watchedAt)
    });

    await expect(service.markEpisodeWatched(10)).rejects.toThrow('offline');
    expect((await repository.getSubject(1))?.lastWatchedAt).toBeNull();
  });

  it('restores the previous watch time when a queued watch is rolled back', async () => {
    const originalTime = '2026-11-01T00:00:00.000Z';
    await repository.upsertSubject(subject(1));
    await repository.replaceSubjectEpisodes(1, [episode(1)]);
    await repository.setSubjectLastWatchedAt(1, watchedAt);
    await repository.markEpisodeWatched(10);
    await repository.enqueueOperation({
      resourceKey: 'subject:1', kind: 'episodes_watched',
      payload: JSON.stringify({ subjectId: 1, episodeIds: [10], watchedAt }),
      rollback: JSON.stringify({
        subject: { id: 1, collectionType: 3, plannerMode: 'backlog', completedAt: null, lastWatchedAt: originalTime },
        episodes: [{ id: 10, collectionType: 0 }]
      }),
      retryUntil: '2026-11-04T00:00:00.000Z'
    });

    createDashboardService({ auth, client: client(), repository, clock: () => new Date(watchedAt) });

    await vi.waitFor(async () => expect((await repository.getSubject(1))?.lastWatchedAt).toBe(originalTime));
    expect((await repository.getEpisode(10))?.collectionType).toBe(0);
  });

  it('does not promote a title when an already watched episode is submitted again', async () => {
    const originalTime = '2026-11-01T00:00:00.000Z';
    await repository.upsertSubject(subject(1));
    await repository.replaceSubjectEpisodes(1, [{ ...episode(1), collectionType: 2 }]);
    await repository.setSubjectLastWatchedAt(1, originalTime);
    const markEpisodesWatched = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth, client: client({ markEpisodesWatched }), repository, clock: () => new Date(watchedAt)
    });

    await service.markEpisodeWatched(10);

    expect(markEpisodesWatched).not.toHaveBeenCalled();
    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(originalTime);
  });

  it('keeps a newer real watch time when an older queued watch fails', async () => {
    await repository.upsertSubject(subject(1));
    await repository.replaceSubjectEpisodes(1, [episode(1)]);
    await repository.setSubjectLastWatchedAt(1, watchedAt);
    await repository.enqueueOperation({
      resourceKey: 'subject:1', kind: 'episodes_watched',
      payload: JSON.stringify({ subjectId: 1, episodeIds: [10], watchedAt: '2026-11-02T00:00:00.000Z' }),
      rollback: JSON.stringify({
        subject: { id: 1, collectionType: 3, plannerMode: 'backlog', completedAt: null, lastWatchedAt: null },
        episodes: [{ id: 10, collectionType: 0 }]
      }), retryUntil: '2026-11-04T00:00:00.000Z'
    });
    createDashboardService({ auth, client: client(), repository, clock: () => new Date(watchedAt) });

    await vi.waitFor(async () => expect(await repository.countPendingOperations()).toBe(0));

    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(watchedAt);
  });

  it('keeps unknown initial viewing undated and records later episode progress', async () => {
    let remoteProgress = 1;
    let remoteUpdatedAt = 1793872800;
    const remoteClient = client({
      getAnimeCollections: async (_name, type) => ({ total: type === 3 ? 1 : 0, data: type === 3 ? [{
        subject_id: 1, type: 3, ep_status: remoteProgress, updated_at: remoteUpdatedAt,
        subject: { id: 1, name: 'Old anime', name_cn: '旧番', eps: 12, date: '2020-01-01', images: {} }
      }] : [] }),
      getSubjectEpisodes: async () => ({ total: 2, data: [1, 2].map((progress) => ({
        type: progress <= remoteProgress ? 2 : 0, updated_at: progress === 2 ? remoteUpdatedAt : 0,
        episode: { id: progress * 10, type: 0, sort: progress, ep: progress, name: '', name_cn: '', airdate: '2020-01-01' }
      })) })
    });

    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    expect((await repository.getSubject(1))?.lastWatchedAt).toBeNull();
    remoteUpdatedAt += 60;
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    expect((await repository.getSubject(1))?.lastWatchedAt).toBeNull();
    remoteProgress = 2;
    remoteUpdatedAt += 60;
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(new Date(remoteUpdatedAt * 1000).toISOString());
    expect(await repository.listBacklogTasks('2026-11-05', '2026-11-12')).toEqual([]);
  });
  it('detects a newly watched earlier episode even when the highest progress stays unchanged', async () => {
    let fillEarlierEpisode = false;
    const remoteTime = 1793872800;
    const remoteClient = client({
      getAnimeCollections: async (_name, type) => ({ total: type === 3 ? 1 : 0, data: type === 3 ? [{
        subject_id: 1, type: 3, ep_status: 2, updated_at: remoteTime,
        subject: { id: 1, name: 'Old', name_cn: '旧番', eps: 12, date: '2020-01-01', images: {} }
      }] : [] }),
      getSubjectEpisodes: async () => ({ total: 2, data: [1, 2].map((progress) => ({
        type: progress === 2 || fillEarlierEpisode ? 2 : 0, updated_at: progress === 1 && fillEarlierEpisode ? remoteTime : 0,
        episode: { id: progress * 10, type: 0, sort: progress, ep: progress, name: '', name_cn: '', airdate: '2020-01-01' }
      })) })
    });
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    fillEarlierEpisode = true;

    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });

    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(new Date(remoteTime * 1000).toISOString());
  });

  it.each([0, undefined])('does not invent a watch time when episode timestamps are %s', async (timestamp) => {
    let watched = false;
    const remoteClient = remoteProgressClient(() => [{ number: 1, watched, timestamp }], () => watched ? 1 : 0, () => undefined);
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    watched = true;
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    expect((await repository.getSubject(1))?.epStatus).toBe(1);
    expect((await repository.getSubject(1))?.lastWatchedAt).toBeNull();
  });

  it('uses the watched episode time instead of a later collection edit', async () => {
    let watched = false;
    const episodeTime = 1762300800;
    let collectionTime = 1793872800;
    const remoteClient = remoteProgressClient(() => [{ number: 1, watched, timestamp: episodeTime }], () => watched ? 1 : 0, () => collectionTime);
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    watched = true;
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(new Date(episodeTime * 1000).toISOString());
    collectionTime += 1000;
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(new Date(episodeTime * 1000).toISOString());
  });

  it('records a newly discovered watched episode with its real timestamp', async () => {
    let added = false;
    const episodeTime = 1762300800;
    const remoteClient = remoteProgressClient(() => added
      ? [{ number: 1, watched: false, timestamp: 0 }, { number: 2, watched: true, timestamp: episodeTime }]
      : [{ number: 1, watched: false, timestamp: 0 }], () => added ? 1 : 0);
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    added = true;
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(new Date(episodeTime * 1000).toISOString());
  });

  it('backfills initial viewing only from valid watched-episode timestamps', async () => {
    const first = 1762300800;
    const latest = first + 3600;
    const remoteClient = remoteProgressClient(() => [
      { number: 1, watched: true, timestamp: first },
      { number: 2, watched: true, timestamp: latest },
      { number: 3, watched: false, timestamp: latest + 3600 },
      { number: 4, watched: true, timestamp: 0 }
    ], () => 3);
    await syncAnimeCollections({ username: 'test', client: remoteClient, repository, today: '2026-11-05', mode: 'full' });
    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(new Date(latest * 1000).toISOString());
  });

  it('does not let a delayed remote progress response overwrite a newer local watch time', async () => {
    await repository.upsertSubject(subject(1));
    await repository.replaceSubjectEpisodes(1, [episode(1)]);
    await repository.setSubjectLastWatchedAt(1, '2026-11-05T09:00:00.000Z');
    let releaseEpisodes!: () => void;
    const networkGate = new Promise<void>((resolve) => { releaseEpisodes = resolve; });
    const getSubjectEpisodes = vi.fn(async () => {
      await networkGate;
      return { total: 1, data: [{ type: 2, updated_at: Date.parse('2026-11-05T10:00:00.000Z') / 1000, episode: {
        id: 10, type: 0, sort: 1, ep: 1, name: '', name_cn: '', airdate: '2020-01-01'
      } }] };
    });
    const syncing = syncAnimeCollections({ username: 'test', repository, today: '2026-11-05', mode: 'full',
      client: client({
        getAnimeCollections: async (_name, type) => ({ total: type === 3 ? 1 : 0, data: type === 3 ? [{
          subject_id: 1, type: 3, ep_status: 1, updated_at: Date.parse('2026-11-05T10:00:00.000Z') / 1000,
          subject: { id: 1, name: 'Old', name_cn: '旧番', eps: 12, date: '2020-01-01', images: {} }
        }] : [] }), getSubjectEpisodes
      })
    });
    await vi.waitFor(() => expect(getSubjectEpisodes).toHaveBeenCalledOnce());
    const service = createDashboardService({
      auth, client: client(), repository: { ...repository, enqueueOperation: undefined } as unknown as Repository,
      clock: () => new Date(watchedAt)
    });
    await service.markEpisodeWatched(10);
    releaseEpisodes();
    await syncing;

    expect((await repository.getSubject(1))?.lastWatchedAt).toBe(watchedAt);
  });

});

function subject(id: number): SubjectWrite {
  return { id, name: `Old ${id}`, nameCn: `旧番 ${id}`, eps: 12, epStatus: 0, image: null,
    url: `https://bgm.tv/subject/${id}`, collectionType: 3, plannerMode: 'backlog', totalEpisodesKnown: true };
}
function episode(subjectId: number): EpisodeRow {
  return { id: subjectId * 10, subjectId, subjectName: `Old ${subjectId}`, subjectNameCn: `旧番 ${subjectId}`,
    subjectUrl: `https://bgm.tv/subject/${subjectId}`, episodeType: 0, sort: 1, ep: 1, name: '', nameCn: '',
    airdate: '2020-01-01', airTime: '', collectionType: 0, dismissedAt: null, snoozedUntil: null };
}
function client(overrides: Partial<BangumiClient> = {}): BangumiClient {
  return {
    getMe: vi.fn(), getCalendar: async () => [], getAnimeCollections: async () => ({ total: 0, data: [] }),
    getBroadcastCatalog: async () => ({ schedules: new Map(), seasonWindow: {
      currentSeasonKey: '2026Q4', previousSeasonKey: '2026Q3', anchorDate: '2026-10-01',
      overlapThrough: '2026-10-14', authoritative: true, activeSubjectIds: new Set([999]),
      entries: new Map([[999, { subjectId: 999, seasonKey: '2026Q4', seasonKind: 'new',
        normalPremiereDate: '2026-10-01', airTime: '', dayOffset: 0 }]])
    } }),
    getSubjectEpisodes: async () => ({ total: 0, data: [] }), markEpisodesWatched: async () => undefined,
    markEpisodesUnwatched: async () => undefined, setSubjectCollectionType: async () => undefined,
    addSubjectToWatching: async () => undefined, addSubjectToWishlist: async () => undefined,
    searchAnimeSubjects: async () => [], ...overrides
  };
}

function remoteProgressClient(
  episodes: () => Array<{ number: number; watched: boolean; timestamp?: number }>,
  progress: () => number,
  collectionTime: () => number | undefined = () => 1793872800
): BangumiClient {
  return client({
    getAnimeCollections: async (_name, type) => ({ total: type === 3 ? 1 : 0, data: type === 3 ? [{
      subject_id: 1, type: 3, ep_status: progress(), updated_at: collectionTime(),
      subject: { id: 1, name: 'Old anime', name_cn: '旧番', eps: 12, date: '2020-01-01', images: {} }
    }] : [] }),
    getSubjectEpisodes: async () => ({ total: episodes().length, data: episodes().map((item) => ({
      type: item.watched ? 2 : 0, updated_at: item.timestamp,
      episode: { id: item.number * 10, type: 0, sort: item.number, ep: item.number, name: '', airdate: '2020-01-01' }
    })) }) as unknown as BangumiClient['getSubjectEpisodes']
  });
}

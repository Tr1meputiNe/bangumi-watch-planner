import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboardService } from '../../src/server/dashboard.js';
import { createRepository, type Repository } from '../../src/server/db.js';
import { buildSeasonWindow } from '../../src/server/season-window.js';
import { rebuildBacklogPlan, syncAnimeCollections } from '../../src/server/sync.js';
import type { BangumiClient, BroadcastCatalog, SeasonCatalog, SeasonEntry } from '../../src/server/types.js';

describe('collection sync integration', () => {
  let tempDir: string;
  let repository: Repository;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bwp-sync-'));
    repository = createRepository(join(tempDir, 'test.sqlite'));
  });

  afterEach(() => {
    repository.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it.each([
    ['missing', undefined],
    ['empty', async () => emptyCatalog('2026-07-17')],
    ['partial', async () => partialCatalog('2026-07-17')]
  ] as const)('preserves existing data when the authoritative season catalog is %s', async (_case, getBroadcastCatalog) => {
    await repository.upsertSubject({
      ...subjectWrite(101, 3),
      plannerMode: 'seasonal',
      seasonKey: '2026Q3',
      seasonKind: 'new'
    });
    await repository.replaceSubjectEpisodes(101, [episodeRow(1010, 101, '2026-07-04')]);
    await repository.replaceBacklogTasks({
      fromDate: '2026-07-20',
      throughDate: '2026-07-20',
      preserveLocked: false,
      tasks: [{ episodeId: 1010, subjectId: 101, plannedDate: '2026-07-20', slot: 0, locked: false }]
    });
    const upsertSubject = vi.spyOn(repository, 'upsertSubject');
    const replaceBacklogTasks = vi.spyOn(repository, 'replaceBacklogTasks');
    const getAnimeCollections = vi.fn(async () => ({ total: 1, data: [collection(101, 3)] }));
    const client = clientFor({ 1: [], 3: [], 4: [] }, catalogFor('2026-07-17'), {
      getAnimeCollections,
      getBroadcastCatalog
    });

    await expect(syncAnimeCollections({ username: 'sai', client, repository, today: '2026-07-17' }))
      .rejects.toThrow(/authoritative season window/i);

    expect(getAnimeCollections).not.toHaveBeenCalled();
    expect(upsertSubject).not.toHaveBeenCalled();
    expect(replaceBacklogTasks).not.toHaveBeenCalled();
    await expect(repository.getSubject(101)).resolves.toMatchObject({
      collectionType: 3,
      plannerMode: 'seasonal',
      seasonKey: '2026Q3',
      seasonKind: 'new'
    });
    await expect(repository.listBacklogTasks('2026-07-20', '2026-07-20')).resolves.toEqual([
      expect.objectContaining({ episodeId: 1010, plannedDate: '2026-07-20' })
    ]);
  });

  it('classifies current seasonal, unrelated backlog, wishlist, and held collections without remote writes', async () => {
    await repository.upsertSubject({
      ...subjectWrite(999, 2),
      collectionType: 2,
      plannerMode: 'backlog',
      completedAt: '2026-07-01T00:00:00+08:00'
    });
    const setSubjectCollectionType = vi.fn();
    const client = clientFor({
      1: [collection(201, 1, 12, '2024-10-03')],
      3: [collection(101, 3), collection(102, 3), collection(104, 3)],
      4: [collection(401, 4)]
    }, catalogFor('2026-07-17'), { setSubjectCollectionType });

    await syncAnimeCollections({ username: 'sai', client, repository, today: '2026-07-17' });

    await expect(repository.getSubject(101)).resolves.toMatchObject({ plannerMode: 'seasonal', seasonKind: 'new', seasonKey: '2026Q3' });
    await expect(repository.getSubject(102)).resolves.toMatchObject({ plannerMode: 'seasonal', seasonKind: 'continuing', seasonKey: '2026Q3' });
    await expect(repository.getSubject(104)).resolves.toMatchObject({ collectionType: 3, plannerMode: 'backlog', seasonKey: null });
    await expect(repository.getSubject(201)).resolves.toMatchObject({ collectionType: 1, plannerMode: null, airDate: '2024-10-03', airYear: 2024 });
    await expect(repository.getSubject(401)).resolves.toMatchObject({ collectionType: 4, plannerMode: 'backlog' });
    await expect(repository.getSubject(999)).resolves.toMatchObject({ collectionType: 2, completedAt: '2026-07-01T00:00:00+08:00' });
    expect(client.getSubjectEpisodes).not.toHaveBeenCalledWith(201, expect.anything(), expect.anything());
    expect(setSubjectCollectionType).not.toHaveBeenCalled();
  });

  it('keeps previous-quarter watching seasonal through overlap day 14, then moves it to backlog on day 15', async () => {
    const collections = { 1: [collection(203, 1)], 3: [collection(103, 3)], 4: [] };

    await syncAnimeCollections({
      username: 'sai',
      repository,
      today: '2026-07-17',
      client: clientFor(collections, catalogFor('2026-07-17'))
    });
    await expect(repository.getSubject(103)).resolves.toMatchObject({ plannerMode: 'seasonal', seasonKey: '2026Q2' });
    await expect(repository.listWishlist('', null)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 203, isCurrentSeason: true })]
    });

    await syncAnimeCollections({
      username: 'sai',
      repository,
      today: '2026-07-18',
      client: clientFor(collections, catalogFor('2026-07-18'))
    });
    await expect(repository.getSubject(103)).resolves.toMatchObject({ plannerMode: 'backlog', seasonKey: null, seasonKind: null });
    await expect(repository.listWishlist('', null)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 203, isCurrentSeason: false })]
    });
  });

  it('uses only fetched main episodes to correct display totals and known-total safety', async () => {
    const episodesBySubject = new Map([
      [301, mainEpisodes(301, 12)],
      [302, mainEpisodes(302, 12)],
      [303, [...mainEpisodes(303, 2), episodeCollection(30399, 303, 99, 1), episodeCollection(30400, 303, 100, 2)]]
    ]);
    const client = clientFor({
      1: [],
      3: [collection(301, 3, 0), collection(302, 3, 10), collection(303, 3, 0)],
      4: []
    }, catalogFor('2026-07-18'), {
      getSubjectEpisodes: vi.fn(async (subjectId) => ({ total: episodesBySubject.get(subjectId)?.length ?? 0, data: episodesBySubject.get(subjectId) ?? [] }))
    });

    await syncAnimeCollections({ username: 'sai', client, repository, today: '2026-07-18' });

    await expect(repository.getSubject(301)).resolves.toMatchObject({ eps: 12, totalEpisodesKnown: false });
    await expect(repository.getSubject(302)).resolves.toMatchObject({ eps: 12, totalEpisodesKnown: true });
    await expect(repository.getSubject(303)).resolves.toMatchObject({ eps: 2, totalEpisodesKnown: false });
    const withExtras = (await repository.listSubjects()).find((subject) => subject.id === 303);
    expect(withExtras?.mainEpisodes).toHaveLength(2);
    expect(withExtras?.unwatchedMainEpisodeCount).toBe(2);
  });

  it('keeps an out-of-season title in watching while its main episodes are still updating', async () => {
    const updatingEpisode = episodeCollection(1501, 150, 1);
    updatingEpisode.episode.airdate = '2026-07-25';
    const finishedEpisode = episodeCollection(1511, 151, 1);
    finishedEpisode.episode.airdate = '2025-01-01';
    const client = clientFor({
      1: [],
      3: [collection(150, 3, 12, '2024-01-01'), collection(151, 3, 12, '2024-01-01')],
      4: []
    }, catalogFor('2026-07-19'), {
      getSubjectEpisodes: vi.fn(async (subjectId) => ({
        total: 1,
        data: subjectId === 150 ? [updatingEpisode] : [finishedEpisode]
      }))
    });

    await repository.upsertSubject({ ...subjectWrite(150, 3), plannerMode: 'backlog' });
    await repository.replaceSubjectEpisodes(150, [episodeRow(1501, 150, '2026-07-25')]);
    await repository.replaceBacklogTasks({
      fromDate: '2026-07-19',
      throughDate: '2026-07-19',
      preserveLocked: false,
      tasks: [{ episodeId: 1501, subjectId: 150, plannedDate: '2026-07-19', slot: 0, locked: false }]
    });

    await syncAnimeCollections({ username: 'sai', client, repository, today: '2026-07-19' });

    await expect(repository.getSubject(150)).resolves.toMatchObject({ plannerMode: 'seasonal' });
    await expect(repository.getSubject(151)).resolves.toMatchObject({ plannerMode: 'backlog' });
    expect((await repository.listBacklogTasks('2026-07-19', '2026-07-25')).some((item) => item.subjectId === 150)).toBe(false);
  });

  it('rebuilds tomorrow through day six while preserving locked today and planner overrides', async () => {
    await repository.upsertSubject({ ...subjectWrite(1, 3), plannerMode: 'seasonal' });
    await repository.replaceSubjectEpisodes(1, [episodeRow(11, 1, '2026-07-26')]);
    await repository.upsertSubject({ ...subjectWrite(2, 3), plannerMode: 'backlog' });
    await repository.replaceSubjectEpisodes(2, [
      episodeRow(21, 2, '2020-01-01'),
      episodeRow(22, 2, '2020-01-08'),
      episodeRow(23, 2, '2020-01-15'),
      episodeRow(24, 2, '2020-01-22')
    ]);
    await repository.replaceBacklogTasks({
      fromDate: '2026-07-18',
      throughDate: '2026-07-20',
      preserveLocked: false,
      tasks: [
        task(21, '2026-07-18', 0),
        task(22, '2026-07-19', 0),
        task(23, '2026-07-20', 0)
      ]
    });
    await repository.skipBacklogDate('2026-07-20');
    await repository.excludeEpisodeOnDate('2026-07-21', 21);

    await rebuildBacklogPlan({ repository, today: '2026-07-19', includeToday: false });

    const tasks = await repository.listBacklogTasks('2026-07-18', '2026-07-26');
    expect(tasks).toContainEqual(expect.objectContaining({ episodeId: 22, plannedDate: '2026-07-19', locked: true }));
    expect(tasks.some((item) => item.plannedDate === '2026-07-20')).toBe(false);
    expect(tasks).toContainEqual(expect.objectContaining({ episodeId: 21 }));
    expect(tasks.find((item) => item.episodeId === 21)?.plannedDate).not.toBe('2026-07-21');
    expect(tasks.every((item) => item.plannedDate >= '2026-07-19' && item.plannedDate <= '2026-07-25')).toBe(true);
    await expect(repository.listSkippedBacklogDates('2026-07-19', '2026-07-25')).resolves.toEqual(['2026-07-20']);
    await expect(repository.listBacklogExclusions('2026-07-19', '2026-07-25')).resolves.toEqual([
      { plannedDate: '2026-07-21', episodeId: 21 }
    ]);
    expect(await repository.getSetting('backlog_rotation_cursor')).toBe('2');
  });

  it('does not add more tasks today after the planned tasks are watched', async () => {
    await repository.upsertSubject({ ...subjectWrite(2, 3), plannerMode: 'backlog' });
    await repository.replaceSubjectEpisodes(2, [
      episodeRow(21, 2, '2020-01-01'),
      episodeRow(22, 2, '2020-01-08'),
      episodeRow(23, 2, '2020-01-15'),
      episodeRow(24, 2, '2020-01-22')
    ]);
    await rebuildBacklogPlan({ repository, today: '2026-07-19', includeToday: true });
    const plannedToday = await repository.listBacklogTasks('2026-07-19', '2026-07-19');
    expect(plannedToday).toHaveLength(2);

    const service = createDashboardService({
      auth: {
        createAuthorizationUrl: vi.fn(),
        handleCallback: vi.fn(),
        getAccessToken: vi.fn(),
        getAuthStatus: vi.fn()
      },
      client: clientFor({ 1: [], 3: [], 4: [] }, catalogFor('2026-07-19')),
      repository,
      clock: () => new Date('2026-07-19T04:00:00.000Z')
    });

    for (const task of plannedToday) {
      await service.markEpisodeWatched(task.episodeId);
    }

    await expect(repository.listBacklogTasks('2026-07-19', '2026-07-19')).resolves.toEqual([]);
    expect(await repository.listBacklogTasks('2026-07-20', '2026-07-25')).not.toHaveLength(0);
  });
});

function clientFor(
  collections: Record<1 | 3 | 4, ReturnType<typeof collection>[]>,
  catalog: BroadcastCatalog,
  overrides: Partial<BangumiClient> = {}
): BangumiClient {
  return {
    getMe: vi.fn(),
    getCalendar: vi.fn(async () => []),
    getAnimeCollections: vi.fn(async (_username, type) => ({ total: collections[type].length, data: collections[type] })),
    getWatchingAnime: vi.fn(async () => ({ total: 0, data: [] })),
    getSubjectEpisodes: vi.fn(async (subjectId) => ({ total: 1, data: [episodeCollection(subjectId * 10, subjectId, 1)] })),
    getBroadcastCatalog: vi.fn(async () => catalog),
    markEpisodesWatched: vi.fn(),
    markEpisodesUnwatched: vi.fn(),
    setSubjectCollectionType: vi.fn(),
    addSubjectToWatching: vi.fn(),
    addSubjectToWishlist: vi.fn(),
    searchAnimeSubjects: vi.fn(async () => []),
    ...overrides
  };
}

function catalogFor(today: string): BroadcastCatalog {
  const current = seasonCatalog('2026Q3', [
    seasonEntry(101, '2026Q3', 'new', '2026-07-04'),
    seasonEntry(102, '2026Q3', 'continuing', '2026-07-06')
  ]);
  const previous = seasonCatalog('2026Q2', [
    seasonEntry(103, '2026Q2', 'new', '2026-04-02'),
    seasonEntry(203, '2026Q2', 'new', '2026-04-03')
  ]);
  return { schedules: new Map(), seasonWindow: buildSeasonWindow(today, current, previous) };
}

function emptyCatalog(today: string): BroadcastCatalog {
  return {
    schedules: new Map(),
    seasonWindow: {
      currentSeasonKey: '2026Q3',
      previousSeasonKey: '2026Q2',
      anchorDate: today,
      overlapThrough: today,
      authoritative: true,
      activeSubjectIds: new Set(),
      entries: new Map()
    }
  };
}

function partialCatalog(today: string): BroadcastCatalog {
  const catalog = catalogFor(today);
  return {
    ...catalog,
    seasonWindow: { ...catalog.seasonWindow, authoritative: false }
  };
}

function seasonCatalog(seasonKey: string, entries: SeasonEntry[]): SeasonCatalog {
  return { seasonKey, entries: new Map(entries.map((entry) => [entry.subjectId, entry])) };
}

function seasonEntry(subjectId: number, seasonKey: string, seasonKind: 'new' | 'continuing', normalPremiereDate: string): SeasonEntry {
  return { subjectId, seasonKey, seasonKind, normalPremiereDate, airTime: '20:00', dayOffset: 0 };
}

function collection(id: number, type: 1 | 3 | 4, eps = 12, date?: string) {
  return {
    subject_id: id,
    type,
    ep_status: 0,
    subject: { id, name: `Subject ${id}`, name_cn: `番剧 ${id}`, date, eps, images: {} }
  };
}

function mainEpisodes(subjectId: number, count: number) {
  return Array.from({ length: count }, (_, index) => episodeCollection(subjectId * 100 + index, subjectId, index + 1));
}

function episodeCollection(id: number, subjectId: number, ep: number, type = 0) {
  return {
    type: 0,
    updated_at: 0,
    episode: { id, subject_id: subjectId, type, sort: ep, ep, name: `Episode ${ep}`, name_cn: '', airdate: '2026-07-01' }
  };
}

function subjectWrite(id: number, collectionType: 1 | 2 | 3 | 4) {
  return {
    id,
    name: `Subject ${id}`,
    nameCn: `番剧 ${id}`,
    eps: 12,
    epStatus: 0,
    image: null,
    url: `https://bgm.tv/subject/${id}`,
    collectionType,
    plannerMode: collectionType === 3 ? 'backlog' as const : null,
    seasonKey: null,
    seasonKind: null,
    airYear: null,
    totalEpisodesKnown: true,
    completedAt: null
  };
}

function episodeRow(id: number, subjectId: number, airdate: string) {
  return {
    id,
    subjectId,
    subjectName: `Subject ${subjectId}`,
    subjectNameCn: `番剧 ${subjectId}`,
    subjectUrl: `https://bgm.tv/subject/${subjectId}`,
    episodeType: 0,
    sort: id,
    ep: id,
    name: `Episode ${id}`,
    nameCn: '',
    airdate,
    airTime: '',
    collectionType: 0,
    dismissedAt: null,
    snoozedUntil: null
  };
}

function task(episodeId: number, plannedDate: string, slot: number) {
  return { episodeId, subjectId: 2, plannedDate, slot, locked: false };
}

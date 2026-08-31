import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../src/server/db.js';
import { applyBroadcastOverrides, rebuildBacklogPlan, syncAnimeCollections } from '../../src/server/sync.js';
import type { BangumiClient, BroadcastCatalog, EpisodeRow, SubjectWrite, SyncProgress, SyncRepository } from '../../src/server/types.js';

describe('syncAnimeCollections', () => {
  it('applies a local whole-series date and time correction', () => {
    const corrected = applyBroadcastOverrides(
      new Map([[501, { airDate: '2026-07-25', airTime: '00:30', dayOffset: 0, source: 'Yuc Wiki' }]]),
      [{ subjectId: 501, airDate: '2026-07-11', airTime: '01:00', dateShiftDays: -7, updatedAt: '2026-07-30' }]
    );

    expect(corrected.get(501)).toEqual({
      airDate: '2026-07-18',
      airTime: '01:00',
      dayOffset: -7,
      source: '本地修正'
    });
  });

  it('paginates wishlist, watching, and held independently without fetching wishlist episodes', async () => {
    const getAnimeCollections = vi.fn(async (_username: string, type: 1 | 3 | 4, _limit: number, offset: number) => {
      if (type === 1) {
        return { total: 1, data: [collection(1, 1, { date: '2024-10-03' })] };
      }
      if (type === 3 && offset === 0) {
        return { total: 51, data: [collection(3, 3)] };
      }
      if (type === 3) {
        return { total: 51, data: [collection(4, 3, { date: 'not-a-date' })] };
      }
      return { total: 1, data: [collection(5, 4)] };
    });
    const getSubjectEpisodes = vi.fn(async () => ({ total: 0, data: [] }));
    const setSubjectCollectionType = vi.fn();
    const savedSubjects: SubjectWrite[] = [];
    const replacedSubjectIds: number[] = [];
    const repository = syncRepository({
      upsertSubject: vi.fn(async (subject) => { savedSubjects.push(subject); }),
      replaceSubjectEpisodes: vi.fn(async (subjectId) => { replacedSubjectIds.push(subjectId); })
    });

    const result = await syncAnimeCollections({
      username: 'sai',
      today: '2026-07-19',
      client: bangumiClient({ getAnimeCollections, getSubjectEpisodes, setSubjectCollectionType }),
      repository
    });

    expect(getAnimeCollections.mock.calls).toEqual([
      ['sai', 1, 50, 0],
      ['sai', 3, 50, 0],
      ['sai', 3, 50, 50],
      ['sai', 4, 50, 0]
    ]);
    expect(getSubjectEpisodes).not.toHaveBeenCalledWith(1, expect.anything(), expect.anything());
    expect(getSubjectEpisodes.mock.calls.map(([subjectId]) => subjectId)).toEqual([3, 4, 5]);
    expect(replacedSubjectIds).toEqual([3, 4, 5]);
    expect(savedSubjects.map(({ id, airYear }) => ({ id, airYear }))).toEqual([
      { id: 1, airYear: 2024 },
      { id: 3, airYear: null },
      { id: 4, airYear: null },
      { id: 5, airYear: null }
    ]);
    expect(setSubjectCollectionType).not.toHaveBeenCalled();
    expect(result).toEqual({ subjectsSynced: 4, episodesSynced: 0 });
  });

  it('keeps late-night and one-week broadcast date corrections', async () => {
    const savedEpisodes: EpisodeRow[] = [];
    const schedules = new Map([
      [1, { airDate: '2026-07-02', airTime: '01:30', dayOffset: 1 }],
      [2, { airDate: '2026-06-27', airTime: '20:30', dayOffset: 0 }]
    ]);
    const client = bangumiClient({
      getBroadcastCatalog: vi.fn(async () => broadcastCatalog(schedules)),
      getAnimeCollections: vi.fn(async (_username, type) => ({
        total: type === 3 ? 2 : 0,
        data: type === 3 ? [collection(1, 3), collection(2, 3)] : []
      })),
      getSubjectEpisodes: vi.fn(async (subjectId) => ({
        total: 2,
        data: subjectId === 1
          ? [episodeCollection(11, 1, 1, '2026-07-01'), episodeCollection(12, 1, 2, '2026-07-08')]
          : [episodeCollection(21, 2, 1, '2026-07-04'), episodeCollection(22, 2, 2, '2026-07-11')]
      }))
    });

    await syncAnimeCollections({
      username: 'sai',
      today: '2026-07-19',
      client,
      repository: syncRepository({
        replaceSubjectEpisodes: vi.fn(async (_subjectId, episodes) => { savedEpisodes.push(...episodes); })
      })
    });

    expect(savedEpisodes.map(({ id, airdate, airTime }) => ({ id, airdate, airTime }))).toEqual([
      { id: 11, airdate: '2026-07-02', airTime: '01:30' },
      { id: 12, airdate: '2026-07-09', airTime: '01:30' },
      { id: 21, airdate: '2026-06-27', airTime: '20:30' },
      { id: 22, airdate: '2026-07-04', airTime: '20:30' }
    ]);
  });

  it('paginates every episode collection', async () => {
    const getSubjectEpisodes = vi
      .fn()
      .mockResolvedValueOnce({ total: 1001, data: [episodeCollection(1, 1, 1, '2026-07-01')] })
      .mockResolvedValueOnce({ total: 1001, data: [episodeCollection(1001, 1, 1001, '2026-07-02')] });

    const result = await syncAnimeCollections({
      username: 'sai',
      today: '2026-07-19',
      client: bangumiClient({
        getAnimeCollections: vi.fn(async (_username, type) => ({
          total: type === 3 ? 1 : 0,
          data: type === 3 ? [collection(1, 3)] : []
        })),
        getSubjectEpisodes
      }),
      repository: syncRepository()
    });

    expect(getSubjectEpisodes.mock.calls).toEqual([[1, 1000, 0], [1, 1000, 1000]]);
    expect(result.episodesSynced).toBe(2);
  });

  it('reports subject progress and limits episode fetches to three at a time', async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const progress: SyncProgress[] = [];
    const getSubjectEpisodes = vi.fn(async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequests -= 1;
      return { total: 0, data: [] };
    });

    await syncAnimeCollections({
      username: 'sai',
      today: '2026-07-19',
      client: bangumiClient({
        getAnimeCollections: vi.fn(async (_username, type) => ({
          total: type === 3 ? 7 : 0,
          data: type === 3 ? Array.from({ length: 7 }, (_, index) => collection(index + 1, 3)) : []
        })),
        getSubjectEpisodes
      }),
      repository: syncRepository(),
      onProgress: (update) => progress.push(update)
    });

    expect(maxActiveRequests).toBe(3);
    expect(progress).toEqual(Array.from({ length: 8 }, (_, processedSubjects) => ({
      processedSubjects,
      totalSubjects: 7
    })));
  });
});

describe('rebuildBacklogPlan', () => {
  it('does not advance the rotation cursor when task replacement fails', async () => {
    const setSetting = vi.fn();
    const repository = syncRepository({
      replaceBacklogTasks: vi.fn(async () => { throw new Error('replace failed'); }),
      setSetting
    });

    await expect(rebuildBacklogPlan({ repository: repository as Repository, today: '2026-07-19', includeToday: false }))
      .rejects.toThrow('replace failed');

    expect(setSetting).not.toHaveBeenCalledWith('backlog_rotation_cursor', expect.anything());
  });
});

function bangumiClient(overrides: Partial<BangumiClient> = {}): BangumiClient {
  return {
    getMe: vi.fn(),
    getCalendar: vi.fn(async () => []),
    getAnimeCollections: vi.fn(async () => ({ total: 0, data: [] })),
    getWatchingAnime: vi.fn(async () => ({ total: 0, data: [] })),
    getSubjectEpisodes: vi.fn(async () => ({ total: 0, data: [] })),
    getBroadcastCatalog: vi.fn(async () => broadcastCatalog()),
    markEpisodesWatched: vi.fn(),
    markEpisodesUnwatched: vi.fn(),
    setSubjectCollectionType: vi.fn(),
    addSubjectToWatching: vi.fn(),
    addSubjectToWishlist: vi.fn(),
    searchAnimeSubjects: vi.fn(async () => []),
    ...overrides
  };
}

function syncRepository(overrides: Partial<SyncRepository> = {}): SyncRepository {
  return {
    upsertSubject: vi.fn(),
    replaceSubjectEpisodes: vi.fn(),
    getSetting: vi.fn(async () => null),
    setSetting: vi.fn(),
    listSubjectsByMode: vi.fn(async () => []),
    listBacklogTasks: vi.fn(async () => []),
    replaceBacklogTasks: vi.fn(),
    lockBacklogDate: vi.fn(),
    listSkippedBacklogDates: vi.fn(async () => []),
    listBacklogExclusions: vi.fn(async () => []),
    prunePlannerState: vi.fn(),
    listBroadcastOverrides: vi.fn(async () => []),
    ...overrides
  };
}

function collection(id: number, type: 1 | 3 | 4, subject: { date?: string; eps?: number } = {}) {
  return {
    subject_id: id,
    type,
    ep_status: 0,
    subject: { id, name: `Subject ${id}`, name_cn: `番剧 ${id}`, eps: 12, images: {}, ...subject }
  };
}

function episodeCollection(id: number, subjectId: number, ep: number, airdate: string, episodeType = 0) {
  return {
    type: 0,
    updated_at: 0,
    episode: { id, subject_id: subjectId, type: episodeType, sort: ep, ep, name: `Episode ${ep}`, name_cn: '', airdate }
  };
}

function broadcastCatalog(schedules = new Map()): BroadcastCatalog {
  return {
    schedules,
    seasonWindow: {
      currentSeasonKey: '2026Q3',
      previousSeasonKey: '2026Q2',
      anchorDate: '2026-07-01',
      overlapThrough: '2026-07-14',
      authoritative: true,
      activeSubjectIds: new Set([999]),
      entries: new Map([[999, {
        subjectId: 999,
        seasonKey: '2026Q3',
        seasonKind: 'new',
        normalPremiereDate: '2026-07-01',
        airTime: '20:00',
        dayOffset: 0
      }]])
    }
  };
}

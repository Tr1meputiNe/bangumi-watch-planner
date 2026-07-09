import { describe, expect, it, vi } from 'vitest';
import { createDashboardService } from '../../src/server/dashboard.js';
import type { AnimeSearchResult, BangumiClient, EpisodeRow } from '../../src/server/types.js';
import type { Repository } from '../../src/server/db.js';

describe('dashboard service', () => {
  it('marks every unwatched main episode through the selected episode', async () => {
    const markEpisodesWatched = vi.fn(async () => undefined);
    const markEpisodeWatched = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ markEpisodesWatched }),
      repository: repository({
        getEpisode: async () => episode({ id: 13, sort: 3, ep: 3 }),
        listEpisodes: async () => [
          episode({ id: 10, sort: 1, ep: 1, collectionType: 2 }),
          episode({ id: 11, sort: 1, ep: 1, collectionType: 0 }),
          episode({ id: 12, sort: 2, ep: 2, collectionType: 0 }),
          episode({ id: 13, sort: 3, ep: 3, collectionType: 0 }),
          episode({ id: 14, sort: 4, ep: 4, collectionType: 0 }),
          episode({ id: 15, sort: 1, ep: null, episodeType: 1, collectionType: 0 })
        ],
        markEpisodeWatched
      })
    });

    await (service as any).markSubjectEpisodesWatchedThrough(1, 13);

    expect(markEpisodesWatched).toHaveBeenCalledWith(1, [11, 12, 13]);
    expect(markEpisodeWatched).toHaveBeenCalledTimes(3);
    expect(markEpisodeWatched).toHaveBeenNthCalledWith(1, 11);
    expect(markEpisodeWatched).toHaveBeenNthCalledWith(2, 12);
    expect(markEpisodeWatched).toHaveBeenNthCalledWith(3, 13);
  });

  it('adds a subject to watching and runs one refresh sync', async () => {
    const addSubjectToWatching = vi.fn(async () => undefined);
    const getWatchingAnime = vi.fn(async () => ({ total: 0, data: [] }));
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ addSubjectToWatching, getWatchingAnime }),
      repository: repository()
    });

    await (service as any).addSubjectToWatching(456);

    expect(addSubjectToWatching).toHaveBeenCalledWith(456);
    expect(getWatchingAnime).toHaveBeenCalledWith('sai', 50, 0);
  });

  it('passes anime search through to the Bangumi client after trimming the keyword', async () => {
    const searchAnimeSubjects = vi.fn(async (): Promise<AnimeSearchResult[]> => [
      {
        id: 456,
        name: 'Test Anime',
        nameCn: '测试动画',
        eps: 12,
        image: null,
        url: 'https://bgm.tv/subject/456'
      }
    ]);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ searchAnimeSubjects }),
      repository: repository()
    });

    await expect((service as any).searchAnimeSubjects('  测试  ')).resolves.toHaveLength(1);
    expect(searchAnimeSubjects).toHaveBeenCalledWith('测试');
  });

  it('passes calendar loading through to the Bangumi client', async () => {
    const getCalendar = vi.fn(async () => [
      {
        weekday: { en: 'Thu', cn: '星期四', ja: '木耀日', id: 4 },
        items: []
      }
    ]);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ getCalendar }),
      repository: repository()
    });

    await expect(service.getCalendar()).resolves.toEqual([
      {
        weekday: { en: 'Thu', cn: '星期四', ja: '木耀日', id: 4 },
        items: []
      }
    ]);
    expect(getCalendar).toHaveBeenCalled();
  });

  it('deduplicates concurrent manual sync requests', async () => {
    let releaseSync: (() => void) | null = null;
    let resolveSyncStarted: (() => void) | null = null;
    const syncStarted = new Promise<void>((resolve) => {
      resolveSyncStarted = resolve;
    });
    const getWatchingAnime = vi.fn(
      async () =>
        new Promise<{ total: number; data: [] }>((resolve) => {
          releaseSync = () => resolve({ total: 0, data: [] });
          resolveSyncStarted?.();
        })
    );
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ getWatchingAnime }),
      repository: repository()
    });

    const first = service.syncNow();
    const second = service.syncNow();
    await syncStarted;
    releaseSync?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { subjectsSynced: 0, episodesSynced: 0 },
      { subjectsSynced: 0, episodesSynced: 0 }
    ]);
    expect(getWatchingAnime).toHaveBeenCalledTimes(1);
  });

  it('stores and throws a readable sync error for transient Bangumi failures', async () => {
    const setSetting = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({
        getWatchingAnime: vi.fn(async () => {
          throw new TypeError('fetch failed');
        })
      }),
      repository: repository({ setSetting })
    });

    await expect(service.syncNow()).rejects.toMatchObject({
      message: 'Bangumi 同步暂时失败，请稍后再试',
      statusCode: 502,
      expose: true
    });
    expect(setSetting).toHaveBeenCalledWith('last_error', 'Bangumi 同步暂时失败，请稍后再试');
  });
});

function authStatus() {
  return {
    createAuthorizationUrl: vi.fn(),
    handleCallback: vi.fn(),
    getAccessToken: vi.fn(),
    getAuthStatus: vi.fn(async () => ({
      authenticated: true,
      username: 'sai',
      nickname: 'Sai',
      lastSyncAt: null
    }))
  };
}

function client(overrides: Partial<BangumiClient> = {}): BangumiClient {
  return {
    getMe: vi.fn(),
    getCalendar: vi.fn(async () => []),
    getWatchingAnime: vi.fn(async () => ({ total: 0, data: [] })),
    getSubjectEpisodes: vi.fn(),
    markEpisodesWatched: vi.fn(),
    addSubjectToWatching: vi.fn(),
    searchAnimeSubjects: vi.fn(),
    ...overrides
  };
}

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    getSetting: vi.fn(async () => null),
    setSetting: vi.fn(async () => undefined),
    upsertSubject: vi.fn(async () => undefined),
    replaceSubjectEpisodes: vi.fn(async () => undefined),
    listEpisodes: vi.fn(async () => []),
    listSubjects: vi.fn(async () => []),
    getEpisode: vi.fn(async () => null),
    markEpisodeWatched: vi.fn(async () => undefined),
    dismissEpisode: vi.fn(async () => undefined),
    getLastNotificationDate: vi.fn(async () => null),
    setLastNotificationDate: vi.fn(async () => undefined),
    ...overrides
  };
}

function episode(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 11,
    subjectId: 1,
    subjectName: 'Test Anime',
    subjectNameCn: '测试番剧',
    subjectUrl: 'https://bgm.tv/subject/1',
    episodeType: 0,
    sort: 1,
    ep: 1,
    name: 'episode',
    nameCn: '第 1 集',
    airdate: '2026-07-08',
    collectionType: 0,
    dismissedAt: null,
    ...overrides
  };
}

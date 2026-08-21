import { describe, expect, it, vi } from 'vitest';
import { canAutoComplete, createDashboardService } from '../../src/server/dashboard.js';
import type {
  AnimeSearchSubject,
  BacklogTaskRow,
  BangumiClient,
  DashboardSubject,
  EpisodeRow,
  SubjectRow,
  SyncProgress
} from '../../src/server/types.js';
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

    await service.markSubjectEpisodesWatchedThrough(1, 13);

    expect(markEpisodesWatched).toHaveBeenCalledWith(1, [11, 12, 13]);
    expect(markEpisodeWatched).toHaveBeenCalledTimes(3);
    expect(markEpisodeWatched).toHaveBeenNthCalledWith(1, 11);
    expect(markEpisodeWatched).toHaveBeenNthCalledWith(2, 12);
    expect(markEpisodeWatched).toHaveBeenNthCalledWith(3, 13);
  });

  it('marks a watched episode unwatched', async () => {
    const markEpisodesUnwatched = vi.fn(async () => undefined);
    const markEpisodeUnwatched = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ markEpisodesUnwatched }),
      repository: repository({
        getEpisode: async () => episode({ id: 13, subjectId: 1, collectionType: 2 }),
        markEpisodeUnwatched
      })
    });

    await service.markEpisodeUnwatched(13);

    expect(markEpisodesUnwatched).toHaveBeenCalledWith(1, [13]);
    expect(markEpisodeUnwatched).toHaveBeenCalledWith(13);
  });

  it('starts adding a subject to watching in the background and reports its sync', async () => {
    let finishWrite!: () => void;
    const writePending = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const addSubjectToWatching = vi.fn(() => writePending);
    const getAnimeCollections = vi.fn(async () => ({ total: 0, data: [] }));
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ addSubjectToWatching, getAnimeCollections }),
      repository: repository()
    });

    await expect(service.addSubjectToWatching(456)).resolves.toMatchObject({ state: 'running' });

    expect(addSubjectToWatching).toHaveBeenCalledWith(456);
    expect(getAnimeCollections).not.toHaveBeenCalled();

    finishWrite();
    await vi.waitFor(() => expect(service.getSyncStatus().state).toBe('idle'));
    expect(getAnimeCollections.mock.calls).toEqual([
      ['sai', 1, 50, 0],
      ['sai', 3, 50, 0],
      ['sai', 4, 50, 0]
    ]);
  });

  it('adds a subject to the wishlist and runs one refresh sync', async () => {
    const addSubjectToWishlist = vi.fn(async () => undefined);
    const getAnimeCollections = vi.fn(async () => ({ total: 0, data: [] }));
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ addSubjectToWishlist, getAnimeCollections }),
      repository: repository()
    });

    await expect(service.addSubjectToWishlist(456)).resolves.toMatchObject({ state: 'running' });

    await vi.waitFor(() => expect(service.getSyncStatus().state).toBe('idle'));
    expect(addSubjectToWishlist).toHaveBeenCalledWith(456);
    expect(getAnimeCollections).toHaveBeenCalledTimes(3);
  });

  it('adds the legal collection action to every anime search result', async () => {
    const searchAnimeSubjects = vi.fn(async (): Promise<AnimeSearchSubject[]> =>
      Array.from({ length: 9 }, (_, index) => ({
        id: 451 + index,
        name: `Test Anime ${index + 1}`,
        nameCn: `测试动画 ${index + 1}`,
        airDate: index === 8 ? '2099-01-01' : '2024-01-01',
        eps: 12,
        image: null,
        url: `https://bgm.tv/subject/${451 + index}`
      }))
    );
    const subjects = new Map([
      [452, subject({ id: 452, collectionType: 1, airDate: '2099-01-01' })],
      [453, subject({ id: 453, collectionType: 1, seasonKey: '2026Q3', airDate: '2026-07-01' })],
      [454, subject({ id: 454, collectionType: 1, airDate: '2024-01-01' })],
      [455, subject({ id: 455, collectionType: 3 })],
      [456, subject({ id: 456, collectionType: 4 })],
      [457, subject({ id: 457, collectionType: 2, completedAt: '2026-07-28T00:00:00+08:00' })],
      [458, subject({ id: 458, collectionType: 5 })]
    ]);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ searchAnimeSubjects }),
      repository: repository({
        getSubject: async (subjectId) => subjects.get(subjectId) ?? null
      })
    });

    await expect(service.searchAnimeSubjects('  测试  ')).resolves.toEqual([
      expect.objectContaining({ id: 451, collectionType: null, watchAction: 'add', watchActionLabel: '加入补番', wishlistAction: 'add', wishlistActionLabel: '加入想看' }),
      expect.objectContaining({ id: 452, collectionType: 1, watchAction: null, watchActionLabel: '尚未播出', wishlistAction: null, wishlistActionLabel: '已在想看' }),
      expect.objectContaining({ id: 453, collectionType: 1, watchAction: 'start', watchActionLabel: '开始追番', wishlistAction: null, wishlistActionLabel: '已在想看' }),
      expect.objectContaining({ id: 454, collectionType: 1, watchAction: 'start', watchActionLabel: '加入补番', wishlistAction: null, wishlistActionLabel: '已在想看' }),
      expect.objectContaining({ id: 455, collectionType: 3, watchAction: null, watchActionLabel: '已在看', wishlistAction: null, wishlistActionLabel: '已在看' }),
      expect.objectContaining({ id: 456, collectionType: 4, watchAction: 'resume', watchActionLabel: '恢复补番', wishlistAction: null, wishlistActionLabel: '已搁置' }),
      expect.objectContaining({ id: 457, collectionType: 2, watchAction: null, watchActionLabel: '已看过', wishlistAction: null, wishlistActionLabel: '已看过' }),
      expect.objectContaining({ id: 458, collectionType: 5, watchAction: null, watchActionLabel: '已抛弃', wishlistAction: null, wishlistActionLabel: '已抛弃' }),
      expect.objectContaining({ id: 459, collectionType: null, watchAction: null, watchActionLabel: '尚未播出', wishlistAction: 'add', wishlistActionLabel: '加入想看' })
    ]);
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

  it('moves corrected broadcasts to the corrected weekday and identifies the source', async () => {
    const service = createDashboardService({
      auth: authStatus(),
      client: client({
        getCalendar: vi.fn(async () => [
          {
            weekday: { en: 'Sat', cn: '星期六', ja: '土耀日', id: 6 },
            items: [{
              id: 501,
              name: 'Corrected Anime',
              nameCn: '校正番剧',
              url: 'https://bgm.tv/subject/501',
              airDate: '2026-07-18',
              airTime: '23:30',
              airWeekday: 6,
              image: null,
              ratingScore: null,
              rank: null,
              collectionDoing: null,
              scheduleSource: 'ACG Secrets' as const
            }]
          },
          { weekday: { en: 'Sun', cn: '星期日', ja: '日耀日', id: 7 }, items: [] }
        ])
      }),
      repository: repository({
        listBroadcastOverrides: vi.fn(async () => [{
          subjectId: 501,
          airDate: '2026-07-19',
          airTime: '01:30',
          dateShiftDays: 1,
          updatedAt: '2026-07-30'
        }])
      })
    });

    const days = await service.getCalendar();

    expect(days.find((day) => day.weekday.id === 6)?.items).toEqual([]);
    expect(days.find((day) => day.weekday.id === 7)?.items).toEqual([
      expect.objectContaining({
        id: 501,
        airDate: '2026-07-19',
        airTime: '01:30',
        scheduleSource: '本地修正',
        baseScheduleSource: 'ACG Secrets',
        isLocalOverride: true,
        localDateShiftDays: 1
      })
    ]);
  });

  it('snoozes a seasonal reminder until the next Shanghai date', async () => {
    const snoozeEpisodeUntil = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({
        getEpisode: vi.fn(async () => episode()),
        getSubject: vi.fn(async () => subject({ plannerMode: 'seasonal' })),
        snoozeEpisodeUntil
      }),
      clock: fixedClock
    });

    await service.snoozeEpisodeUntilTomorrow(11);

    expect(snoozeEpisodeUntil).toHaveBeenCalledWith(11, '2026-07-20');
  });

  it.each([
    ['watched', { collectionType: 2 }],
    ['special', { episodeType: 1 }],
    ['unaired', { airdate: '2026-07-20' }],
    ['dismissed', { dismissedAt: '2026-07-19T00:00:00+08:00' }],
    ['already snoozed', { snoozedUntil: '2026-07-20' }]
  ])('rejects snoozing a %s episode that is not a pending reminder', async (_label, overrides) => {
    const snoozeEpisodeUntil = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({
        getEpisode: vi.fn(async () => episode(overrides)),
        getSubject: vi.fn(async () => subject({ plannerMode: 'seasonal' })),
        snoozeEpisodeUntil
      }),
      clock: fixedClock
    });

    await expect(service.snoozeEpisodeUntilTomorrow(11)).rejects.toMatchObject({ statusCode: 400 });
    expect(snoozeEpisodeUntil).not.toHaveBeenCalled();
  });

  it('keeps backlog, wishlist, held, and completed titles out of the seasonal dashboard', async () => {
    const seasonal = dashboardSubject({ id: 1, plannerMode: 'seasonal', collectionType: 3 });
    const seasonalEpisode = episode({ id: 11, subjectId: 1, airdate: '2026-07-19' });
    const backlogEpisode = episode({ id: 21, subjectId: 2, airdate: '2026-07-19' });
    const listSubjectsByMode = vi.fn(async () => [seasonal]);
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({
        listEpisodes: vi.fn(async () => [seasonalEpisode, backlogEpisode]),
        listSubjectsByMode
      }),
      clock: fixedClock
    });

    const dashboard = await service.getDashboard();
    expect(dashboard.pendingEpisodes).toEqual([seasonalEpisode]);
    expect(dashboard.subjects).toHaveLength(1);
    expect(dashboard.subjects[0]).toMatchObject({ id: seasonal.id, plannerMode: 'seasonal' });
    expect(dashboard.subjects[0]).not.toHaveProperty('mainEpisodes');
    expect(dashboard.subjects[0]).not.toHaveProperty('unwatchedMainEpisodes');
    expect(listSubjectsByMode).toHaveBeenCalledWith('seasonal', [3]);
  });

  it('deduplicates concurrent manual sync requests', async () => {
    let releaseSync: (() => void) | null = null;
    let resolveSyncStarted: (() => void) | null = null;
    const syncStarted = new Promise<void>((resolve) => {
      resolveSyncStarted = resolve;
    });
    const getAnimeCollections = vi.fn(
      async (_username: string, type: 1 | 3 | 4) => {
        if (type !== 1) return { total: 0, data: [] };
        return new Promise<{ total: number; data: [] }>((resolve) => {
          releaseSync = () => resolve({ total: 0, data: [] });
          resolveSyncStarted?.();
        });
      }
    );
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ getAnimeCollections }),
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
    expect(getAnimeCollections).toHaveBeenCalledTimes(3);
  });

  it('starts a background sync and reports progress without making the caller wait', async () => {
    let reportProgress!: (progress: SyncProgress) => void;
    let finishSync!: () => void;
    const syncCollections = vi.fn(async (input: { onProgress?: (progress: SyncProgress) => void }) => {
      reportProgress = input.onProgress!;
      await new Promise<void>((resolve) => {
        finishSync = resolve;
      });
      return { subjectsSynced: 4, episodesSynced: 48 };
    });
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository(),
      clock: () => new Date('2026-07-30T12:00:00.000Z'),
      syncCollections: syncCollections as never
    });

    expect(service.startSync()).toMatchObject({
      state: 'running',
      processedSubjects: 0,
      totalSubjects: 0
    });

    await vi.waitFor(() => expect(syncCollections).toHaveBeenCalledOnce());
    reportProgress({ processedSubjects: 2, totalSubjects: 4 });
    expect(service.getSyncStatus()).toMatchObject({
      state: 'running',
      processedSubjects: 2,
      totalSubjects: 4
    });

    finishSync();
    await expect(service.syncNow()).resolves.toEqual({ subjectsSynced: 4, episodesSynced: 48 });
    expect(service.getSyncStatus()).toMatchObject({
      state: 'idle',
      processedSubjects: 4,
      totalSubjects: 4,
      result: { subjectsSynced: 4, episodesSynced: 48 }
    });
  });

  it('stores and throws a readable sync error for transient Bangumi failures', async () => {
    const setSetting = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({
        getAnimeCollections: vi.fn(async () => {
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
    expect(service.getSyncStatus()).toMatchObject({
      state: 'error',
      error: 'Bangumi 同步暂时失败，请稍后再试'
    });
  });

  it('auto-completes only known totals with enough fetched and watched main episodes', () => {
    const complete = [episode({ id: 11, collectionType: 2 }), episode({ id: 12, sort: 2, ep: 2, collectionType: 2 })];

    expect(canAutoComplete(subject(), complete)).toBe(true);
    expect(canAutoComplete(subject({ totalEpisodesKnown: false }), complete)).toBe(false);
    expect(canAutoComplete(subject({ eps: 3 }), complete)).toBe(false);
    expect(canAutoComplete(subject(), [complete[0], { ...complete[1], collectionType: 0 }])).toBe(false);
    expect(canAutoComplete(subject(), [...complete, episode({ id: 99, episodeType: 1, collectionType: 0 })])).toBe(true);
  });

  it.each([
    [true, '2026-07-01', 'seasonal'],
    [false, '2026-07-01', 'backlog'],
    [false, '2026-07-19', 'seasonal']
  ] as const)('starts a wishlist title and syncs it into the correct planning mode', async (isActive, subjectDate, plannerMode) => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const getAnimeCollections = vi.fn(async (_username: string, type: 1 | 3 | 4) => ({
      total: type === 3 ? 1 : 0,
      data: type === 3 ? [{
        subject_id: 1,
        type: 3,
        ep_status: 0,
        subject: { id: 1, name: 'Test Anime', eps: 2, date: subjectDate }
      }] : []
    }));
    const upsertSubject = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({
        setSubjectCollectionType,
        getAnimeCollections,
        getSubjectEpisodes: vi.fn(async () => ({ total: 0, data: [] })),
        getBroadcastCatalog: vi.fn(async () => ({
          schedules: new Map(),
          seasonWindow: {
            currentSeasonKey: '2026Q3',
            previousSeasonKey: '2026Q2',
            anchorDate: '2026-07-01',
            overlapThrough: '2026-07-14',
            authoritative: true,
            activeSubjectIds: new Set(isActive ? [1] : []),
            entries: new Map([[
              isActive ? 1 : 999,
              {
                subjectId: isActive ? 1 : 999,
                seasonKey: '2026Q3',
                seasonKind: 'new',
                normalPremiereDate: '2026-07-01',
                airTime: '20:00',
                dayOffset: 0
              }
            ]])
          }
        }))
      }),
      repository: repository({ upsertSubject, getSubject: vi.fn(async () => subject({ collectionType: 1, plannerMode: null })) }),
      clock: () => new Date('2026-07-19T04:00:00.000Z')
    });

    await expect(service.startSubject(1)).resolves.toMatchObject({ state: 'running' });

    await vi.waitFor(() => expect(service.getSyncStatus().state).toBe('idle'));
    expect(setSubjectCollectionType).toHaveBeenCalledWith(1, 3);
    expect(setSubjectCollectionType.mock.invocationCallOrder[0]).toBeLessThan(getAnimeCollections.mock.invocationCallOrder[0]);
    expect(upsertSubject).toHaveBeenCalledWith(expect.objectContaining({ id: 1, collectionType: 3, plannerMode }));
  });

  it('keeps an upcoming wishlist title in wishlist when start is requested', async () => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const syncCollections = vi.fn(async () => ({ subjectsSynced: 1, episodesSynced: 0 }));
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({
        getSubject: vi.fn(async () => subject({
          collectionType: 1,
          plannerMode: null,
          ...{ airDate: '2026-08-01' }
        }))
      }),
      clock: () => new Date('2026-07-19T04:00:00.000Z'),
      syncCollections
    });

    await expect(service.startSubject(1)).rejects.toMatchObject({
      message: '尚未播出，已保留在想看',
      statusCode: 400
    });
    expect(setSubjectCollectionType).not.toHaveBeenCalled();
    expect(syncCollections).not.toHaveBeenCalled();
  });

  it('never promotes an old wishlist title during sync alone', async () => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const upsertSubject = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({
        setSubjectCollectionType,
        getAnimeCollections: vi.fn(async (_username, type) => ({
          total: type === 1 ? 1 : 0,
          data: type === 1 ? [{
            subject_id: 1,
            type: 1,
            ep_status: 0,
            subject: { id: 1, name: 'Old Wishlist', eps: 12, date: '2024-01-01' }
          }] : []
        }))
      }),
      repository: repository({ upsertSubject }),
      clock: () => new Date('2026-07-19T04:00:00.000Z')
    });

    await service.syncNow();

    expect(setSubjectCollectionType).not.toHaveBeenCalled();
    expect(upsertSubject).toHaveBeenCalledWith(expect.objectContaining({ collectionType: 1, plannerMode: null }));
  });

  it('pauses a backlog title remotely before local state and replans once', async () => {
    const events: string[] = [];
    const setSubjectCollectionType = vi.fn(async () => { events.push('remote'); });
    const setSubjectState = vi.fn(async () => { events.push('local'); });
    const deleteBacklogTask = vi.fn(async () => { events.push('delete task'); });
    const rebuildPlan = vi.fn(async () => { events.push('replan'); });
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({
        getSubject: vi.fn(async () => subject()),
        listBacklogTasks: vi.fn(async () => [backlogTask()]),
        deleteBacklogTask,
        setSubjectState
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.pauseBacklogSubject(1);

    expect(events).toEqual(['remote', 'local', 'delete task', 'replan']);
    expect(setSubjectCollectionType).toHaveBeenCalledWith(1, 4);
    expect(setSubjectState).toHaveBeenCalledWith(1, {
      collectionType: 4,
      plannerMode: 'backlog',
      completedAt: null
    });
    expect(rebuildPlan).toHaveBeenCalledOnce();
    expect(deleteBacklogTask).toHaveBeenCalledWith(11);
    expect(rebuildPlan).toHaveBeenCalledWith(expect.objectContaining({ today: '2026-07-19', includeToday: true }));
  });

  it('resumes a held title as backlog and replans once', async () => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const setSubjectState = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({ getSubject: vi.fn(async () => subject({ collectionType: 4 })), setSubjectState }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.resumeBacklogSubject(1);

    expect(setSubjectCollectionType).toHaveBeenCalledWith(1, 3);
    expect(setSubjectState).toHaveBeenCalledWith(1, {
      collectionType: 3,
      plannerMode: 'backlog',
      completedAt: null
    });
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it.each([
    ['holdSubject', subject({ plannerMode: 'seasonal', collectionType: 3 }), 4, 'seasonal'],
    ['resumeHeldSubject', subject({ plannerMode: 'backlog', collectionType: 4 }), 3, 'backlog'],
    ['dropSubject', subject({ plannerMode: 'seasonal', collectionType: 3 }), 5, 'seasonal']
  ] as const)('%s preserves the planning origin while changing Bangumi state', async (action, storedSubject, collectionType, plannerMode) => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const setSubjectState = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({ getSubject: vi.fn(async () => storedSubject), setSubjectState }),
      rebuildPlan,
      clock: fixedClock
    });

    await service[action](1);

    expect(setSubjectCollectionType).toHaveBeenCalledWith(1, collectionType);
    expect(setSubjectState).toHaveBeenCalledWith(1, { collectionType, plannerMode, completedAt: null });
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it('returns all held titles with seasonal titles first', async () => {
    const backlog = dashboardSubject({ id: 1, plannerMode: 'backlog', collectionType: 4 });
    const seasonal = dashboardSubject({ id: 2, plannerMode: 'seasonal', collectionType: 4 });
    const listSubjectsByCollection = vi.fn(async () => [backlog, seasonal]);
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({ listSubjectsByCollection })
    });

    await expect(service.getHeldSubjects()).resolves.toEqual([seasonal, backlog]);
    expect(listSubjectsByCollection).toHaveBeenCalledWith([4]);
  });

  it.each([
    ['pause', subject({ plannerMode: 'seasonal', collectionType: 3 })],
    ['pause', subject({ plannerMode: 'backlog', collectionType: 4 })],
    ['resume', subject({ plannerMode: 'seasonal', collectionType: 4 })],
    ['resume', subject({ plannerMode: 'backlog', collectionType: 3 })]
  ] as const)('rejects %s when the subject is not in the required backlog state', async (action, storedSubject) => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const setSubjectState = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({ getSubject: vi.fn(async () => storedSubject), setSubjectState }),
      rebuildPlan,
      clock: fixedClock
    });

    const operation = action === 'pause'
      ? service.pauseBacklogSubject(1)
      : service.resumeBacklogSubject(1);
    await expect(operation).rejects.toMatchObject({ statusCode: 400 });

    expect(setSubjectCollectionType).not.toHaveBeenCalled();
    expect(setSubjectState).not.toHaveBeenCalled();
    expect(rebuildPlan).not.toHaveBeenCalled();
  });

  it('marks the final main episode before completing the subject and replans once', async () => {
    const events: string[] = [];
    const markEpisodesWatched = vi.fn(async () => { events.push('remote episode'); });
    const markEpisodeWatched = vi.fn(async () => { events.push('local episode'); });
    const setSubjectCollectionType = vi.fn(async () => { events.push('remote subject'); });
    const setSubjectState = vi.fn(async () => { events.push('local subject'); });
    const rebuildPlan = vi.fn(async () => { events.push('replan'); });
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ markEpisodesWatched, setSubjectCollectionType }),
      repository: repository({
        getEpisode: vi.fn(async () => episode({ id: 12, sort: 2, ep: 2 })),
        getSubject: vi.fn(async () => subject()),
        listEpisodes: vi.fn(async () => [
          episode({ id: 11, collectionType: 2 }),
          episode({ id: 12, sort: 2, ep: 2, collectionType: 2 })
        ]),
        markEpisodeWatched,
        setSubjectState
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.markEpisodeWatched(12);

    expect(events).toEqual(['remote episode', 'local episode', 'remote subject', 'local subject', 'replan']);
    expect(setSubjectCollectionType).toHaveBeenCalledWith(1, 2);
    expect(setSubjectState).toHaveBeenCalledWith(1, {
      collectionType: 2,
      plannerMode: 'backlog',
      completedAt: '2026-07-19T04:00:00.000Z'
    });
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it('removes a watched task without refilling today', async () => {
    const deleteBacklogTask = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ markEpisodesWatched: vi.fn(async () => undefined) }),
      repository: repository({
        getEpisode: vi.fn(async () => episode()),
        listBacklogTasks: vi.fn(async () => [backlogTask()]),
        markEpisodeWatched: vi.fn(async () => undefined),
        deleteBacklogTask
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.markEpisodeWatched(11);

    expect(deleteBacklogTask).toHaveBeenCalledWith(11);
    expect(rebuildPlan).toHaveBeenCalledWith(expect.objectContaining({ today: '2026-07-19', includeToday: false }));
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it.each([
    [subject({ totalEpisodesKnown: false }), [episode({ id: 11, collectionType: 2 }), episode({ id: 12, sort: 2, ep: 2, collectionType: 2 })]],
    [subject({ eps: 3 }), [episode({ id: 11, collectionType: 2 }), episode({ id: 12, sort: 2, ep: 2, collectionType: 2 })]],
    [subject(), [episode({ id: 11, collectionType: 2 }), episode({ id: 12, sort: 2, ep: 2, collectionType: 0 })]]
  ])('does not auto-complete when the known-total predicate fails', async (storedSubject, episodes) => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({
        getEpisode: vi.fn(async () => episode({ id: 12, sort: 2, ep: 2 })),
        getSubject: vi.fn(async () => storedSubject),
        listEpisodes: vi.fn(async () => episodes),
        markEpisodeWatched: vi.fn(async () => undefined)
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.markEpisodeWatched(12);

    expect(setSubjectCollectionType).not.toHaveBeenCalledWith(1, 2);
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it('does not change SQLite when the episode write fails remotely', async () => {
    const markEpisodeWatched = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ markEpisodesWatched: vi.fn(async () => { throw new Error('remote failed'); }) }),
      repository: repository({ getEpisode: vi.fn(async () => episode()), markEpisodeWatched }),
      rebuildPlan,
      clock: fixedClock
    });

    await expect(service.markEpisodeWatched(11)).rejects.toThrow('remote failed');

    expect(markEpisodeWatched).not.toHaveBeenCalled();
    expect(rebuildPlan).not.toHaveBeenCalled();
  });

  it('does not mark a subject complete when the remote completion write fails', async () => {
    const setSubjectState = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({
        setSubjectCollectionType: vi.fn(async () => { throw new Error('completion failed'); })
      }),
      repository: repository({
        getEpisode: vi.fn(async () => episode({ id: 12, sort: 2, ep: 2 })),
        getSubject: vi.fn(async () => subject()),
        listEpisodes: vi.fn(async () => [
          episode({ id: 11, collectionType: 2 }),
          episode({ id: 12, sort: 2, ep: 2, collectionType: 2 })
        ]),
        markEpisodeWatched: vi.fn(async () => undefined),
        setSubjectState
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await expect(service.markEpisodeWatched(12)).rejects.toThrow('completion failed');

    expect(setSubjectState).not.toHaveBeenCalled();
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it('reopens a completed subject in its existing planner mode', async () => {
    const events: string[] = [];
    const setSubjectCollectionType = vi.fn(async () => { events.push('remote subject'); });
    const setSubjectState = vi.fn(async () => { events.push('local subject'); });
    const rebuildPlan = vi.fn(async () => { events.push('replan'); });
    const service = createDashboardService({
      auth: authStatus(),
      client: client({
        markEpisodesUnwatched: vi.fn(async () => { events.push('remote episode'); }),
        setSubjectCollectionType
      }),
      repository: repository({
        getEpisode: vi.fn(async () => episode({ collectionType: 2 })),
        getSubject: vi.fn(async () => subject({ collectionType: 2, plannerMode: 'backlog', completedAt: '2026-07-18' })),
        markEpisodeUnwatched: vi.fn(async () => { events.push('local episode'); }),
        setSubjectState
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.markEpisodeUnwatched(11);

    expect(events).toEqual(['remote episode', 'local episode', 'remote subject', 'local subject', 'replan']);
    expect(setSubjectCollectionType).toHaveBeenCalledWith(1, 3);
    expect(setSubjectState).toHaveBeenCalledWith(1, {
      collectionType: 3,
      plannerMode: 'backlog',
      completedAt: null
    });
  });

  it('manually completes only a subject with an unknown total', async () => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const setSubjectState = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({
        getSubject: vi.fn(async () => subject({ totalEpisodesKnown: false })),
        setSubjectState
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.completeBacklogSubject(1);

    expect(setSubjectCollectionType).toHaveBeenCalledWith(1, 2);
    expect(setSubjectState).toHaveBeenCalledWith(1, {
      collectionType: 2,
      plannerMode: 'backlog',
      completedAt: '2026-07-19T04:00:00.000Z'
    });
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it('rejects manual completion when the total is known', async () => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const setSubjectState = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({ getSubject: vi.fn(async () => subject()), setSubjectState }),
      rebuildPlan: vi.fn(async () => undefined),
      clock: fixedClock
    });

    await expect(service.completeBacklogSubject(1)).rejects.toMatchObject({ statusCode: 400 });

    expect(setSubjectCollectionType).not.toHaveBeenCalled();
    expect(setSubjectState).not.toHaveBeenCalled();
  });

  it('rejects manual backlog completion for a seasonal title', async () => {
    const setSubjectCollectionType = vi.fn(async () => undefined);
    const setSubjectState = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client({ setSubjectCollectionType }),
      repository: repository({
        getSubject: vi.fn(async () => subject({ plannerMode: 'seasonal', totalEpisodesKnown: false })),
        setSubjectState
      }),
      rebuildPlan: vi.fn(async () => undefined),
      clock: fixedClock
    });

    await expect(service.completeBacklogSubject(1)).rejects.toMatchObject({ statusCode: 400 });

    expect(setSubjectCollectionType).not.toHaveBeenCalled();
    expect(setSubjectState).not.toHaveBeenCalled();
  });

  it('swaps a task by excluding it today and rebuilding all seven dates', async () => {
    const deleteBacklogTask = vi.fn(async () => undefined);
    const excludeEpisodeOnDate = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({
        listBacklogTasks: vi.fn(async () => [backlogTask()]),
        deleteBacklogTask,
        excludeEpisodeOnDate
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.swapBacklogTask(11);

    expect(deleteBacklogTask).toHaveBeenCalledWith(11);
    expect(excludeEpisodeOnDate).toHaveBeenCalledWith('2026-07-19', 11);
    expect(rebuildPlan).toHaveBeenCalledWith(expect.objectContaining({ today: '2026-07-19', includeToday: true }));
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it('rejects swapping an episode that is not in today\'s backlog plan', async () => {
    const deleteBacklogTask = vi.fn(async () => undefined);
    const excludeEpisodeOnDate = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({
        listBacklogTasks: vi.fn(async () => [backlogTask({ episodeId: 12 })]),
        deleteBacklogTask,
        excludeEpisodeOnDate
      }),
      rebuildPlan,
      clock: fixedClock
    });

    await expect(service.swapBacklogTask(11)).rejects.toMatchObject({ statusCode: 404 });

    expect(deleteBacklogTask).not.toHaveBeenCalled();
    expect(excludeEpisodeOnDate).not.toHaveBeenCalled();
    expect(rebuildPlan).not.toHaveBeenCalled();
  });

  it('skips today by clearing its tasks, setting the skip, and replanning once', async () => {
    const replaceBacklogTasks = vi.fn(async () => undefined);
    const skipBacklogDate = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({ replaceBacklogTasks, skipBacklogDate }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.skipBacklogToday();

    expect(replaceBacklogTasks).toHaveBeenCalledWith({
      fromDate: '2026-07-19',
      throughDate: '2026-07-19',
      preserveLocked: false,
      tasks: []
    });
    expect(skipBacklogDate).toHaveBeenCalledWith('2026-07-19');
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it('replans today after clearing its skips, exclusions, and tasks', async () => {
    const clearBacklogDateOverrides = vi.fn(async () => undefined);
    const replaceBacklogTasks = vi.fn(async () => undefined);
    const rebuildPlan = vi.fn(async () => undefined);
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({ clearBacklogDateOverrides, replaceBacklogTasks }),
      rebuildPlan,
      clock: fixedClock
    });

    await service.replanBacklogToday();

    expect(clearBacklogDateOverrides).toHaveBeenCalledWith('2026-07-19');
    expect(replaceBacklogTasks).toHaveBeenCalledWith({
      fromDate: '2026-07-19',
      throughDate: '2026-07-19',
      preserveLocked: false,
      tasks: []
    });
    expect(rebuildPlan).toHaveBeenCalledWith(expect.objectContaining({ today: '2026-07-19', includeToday: true }));
    expect(rebuildPlan).toHaveBeenCalledOnce();
  });

  it('builds the backlog read model and trims wishlist queries with the injected Shanghai clock', async () => {
    const todayTask = backlogTask({ plannedDate: '2026-07-19' });
    const futureTask = backlogTask({ id: 2, episodeId: 12, plannedDate: '2026-07-20', slot: 0 });
    const active = dashboardSubject({ unwatchedMainEpisodeCount: 2 });
    const held = dashboardSubject({ id: 2, collectionType: 4 });
    const completed = dashboardSubject({ id: 3, collectionType: 2, completedAt: '2026-07-18' });
    const seasonalEpisode = episode({ id: 90, subjectId: 9, airdate: '2026-07-20', collectionType: 2 });
    const seasonal = dashboardSubject({ id: 9, plannerMode: 'seasonal', mainEpisodes: [seasonalEpisode] });
    const listWishlist = vi.fn(async () => ({ items: [], years: [2026] }));
    const service = createDashboardService({
      auth: authStatus(),
      client: client(),
      repository: repository({
        listBacklogTasks: vi.fn(async () => [todayTask, futureTask]),
        listSubjectsByMode: vi.fn(async (mode, types) => {
          if (mode === 'seasonal') return [seasonal];
          if (types[0] === 3) return [active];
          if (types[0] === 4) return [held];
          return [completed];
        }),
        listWishlist
      }),
      clock: fixedClock
    });

    const backlog = await service.getBacklog();
    expect(backlog).toMatchObject({
      today: '2026-07-19',
      todayTasks: [todayTask],
      active: [active],
      held: [held],
      completed: [completed],
      estimatedCompletionDate: '2026-07-19'
    });
    expect(backlog.futureDays).toHaveLength(6);
    expect(backlog.futureDays[0]).toEqual({ date: '2026-07-20', seasonalLoad: 1, capacity: 2, tasks: [futureTask] });
    await expect(service.getWishlist('  title  ', 2026)).resolves.toEqual({ items: [], years: [2026] });
    expect(listWishlist).toHaveBeenCalledWith('title', 2026);
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
    getAnimeCollections: vi.fn(async () => ({ total: 0, data: [] })),
    getWatchingAnime: vi.fn(async () => ({ total: 0, data: [] })),
    getSubjectEpisodes: vi.fn(async () => ({ total: 0, data: [] })),
    getBroadcastCatalog: vi.fn(async () => ({
      schedules: new Map(),
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
    })),
    markEpisodesWatched: vi.fn(),
    markEpisodesUnwatched: vi.fn(),
    setSubjectCollectionType: vi.fn(),
    addSubjectToWatching: vi.fn(),
    addSubjectToWishlist: vi.fn(),
    searchAnimeSubjects: vi.fn(),
    ...overrides
  };
}

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    close: vi.fn(),
    getSetting: vi.fn(async () => null),
    setSetting: vi.fn(async () => undefined),
    upsertSubject: vi.fn(async () => undefined),
    replaceSubjectEpisodes: vi.fn(async () => undefined),
    listEpisodes: vi.fn(async () => []),
    listSubjectMainEpisodes: vi.fn(async () => []),
    listSubjects: vi.fn(async () => []),
    getSubject: vi.fn(async () => null),
    listSubjectsByCollection: vi.fn(async () => []),
    listSubjectsByMode: vi.fn(async () => []),
    setSubjectState: vi.fn(async () => undefined),
    listWishlist: vi.fn(async () => ({ items: [], years: [] })),
    listBroadcastOverrides: vi.fn(async () => []),
    saveBroadcastOverride: vi.fn(async () => undefined),
    deleteBroadcastOverride: vi.fn(async () => undefined),
    listBacklogTasks: vi.fn(async () => []),
    replaceBacklogTasks: vi.fn(async () => undefined),
    deleteBacklogTask: vi.fn(async () => undefined),
    lockBacklogDate: vi.fn(async () => undefined),
    skipBacklogDate: vi.fn(async () => undefined),
    clearBacklogDateOverrides: vi.fn(async () => undefined),
    excludeEpisodeOnDate: vi.fn(async () => undefined),
    listSkippedBacklogDates: vi.fn(async () => []),
    listBacklogExclusions: vi.fn(async () => []),
    prunePlannerState: vi.fn(async () => undefined),
    getEpisode: vi.fn(async () => null),
    markEpisodeWatched: vi.fn(async () => undefined),
    markEpisodeUnwatched: vi.fn(async () => undefined),
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
    airTime: '',
    collectionType: 0,
    dismissedAt: null,
    snoozedUntil: null,
    ...overrides
  };
}

function subject(overrides: Partial<SubjectRow> = {}): SubjectRow {
  return {
    id: 1,
    name: 'Test Anime',
    nameCn: '测试番剧',
    eps: 2,
    epStatus: 1,
    image: null,
    url: 'https://bgm.tv/subject/1',
    collectionType: 3,
    plannerMode: 'backlog',
    seasonKey: null,
    seasonKind: null,
    airYear: 2024,
    totalEpisodesKnown: true,
    completedAt: null,
    ...overrides
  };
}

function dashboardSubject(overrides: Partial<DashboardSubject> = {}): DashboardSubject {
  return {
    ...subject(overrides),
    nextEpisode: null,
    mainEpisodes: [],
    unwatchedMainEpisodeCount: 0,
    unwatchedMainEpisodes: [],
    ...overrides
  };
}

function backlogTask(overrides: Partial<BacklogTaskRow> = {}): BacklogTaskRow {
  const episodeId = overrides.episodeId ?? 11;
  return {
    id: 1,
    episodeId,
    subjectId: 1,
    plannedDate: '2026-07-19',
    slot: 0,
    locked: false,
    episode: episode({ id: episodeId }),
    ...overrides
  };
}

function fixedClock(): Date {
  return new Date('2026-07-19T04:00:00.000Z');
}

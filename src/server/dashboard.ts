import { buildReminderCandidates, todayInShanghai } from './reminders.js';
import { episodeProgress } from '../shared/format.js';
import { capacityForSeasonalLoad, countSeasonalLoad, estimateBacklogCompletionDate } from './backlog-planner.js';
import { shiftAirDate } from './broadcast-schedule.js';
import { nextSeasonKey, seasonKeyForDate } from './season-window.js';
import { queueAutoWatchSubject, rebuildBacklogPlan, syncAnimeCollections } from './sync.js';
import { BangumiApiError } from './bangumi-client.js';
import type {
  BacklogData,
  BangumiClient,
  BroadcastOverride,
  CalendarDay,
  DashboardData,
  DashboardSubject,
  DashboardSubjectSummary,
  DashboardService,
  EpisodeRow,
  OAuthManager,
  SubjectRow,
  SyncProgress,
  SyncResult,
  SyncStatus
} from './types.js';
import { progressEpisodesFor, type Repository } from './db.js';

type DashboardDeps = {
  auth: OAuthManager;
  client: BangumiClient;
  repository: Repository;
  clock?: () => Date;
  syncCollections?: typeof syncAnimeCollections;
  rebuildPlan?: typeof rebuildBacklogPlan;
};

export function createDashboardService({
  auth,
  client,
  repository,
  clock = () => new Date(),
  syncCollections = syncAnimeCollections,
  rebuildPlan = rebuildBacklogPlan
}: DashboardDeps): DashboardService {
  let syncInFlight: Promise<SyncResult> | null = null;
  let collectionActionQueue: Promise<void> = Promise.resolve();
  let pendingCollectionActions = 0;
  let collectionActionError: string | null = null;
  let syncStatus: SyncStatus = {
    state: 'idle',
    startedAt: null,
    completedAt: null,
    error: null,
    processedSubjects: 0,
    totalSubjects: 0,
    result: null
  };

  async function executeSync(onProgress?: (progress: SyncProgress) => void): Promise<SyncResult> {
    const status = await auth.getAuthStatus();
    if (!status.username) {
      throw Object.assign(new Error('Bangumi is not connected'), { statusCode: 400, expose: true });
    }

    try {
      return await syncCollections({
        username: status.username,
        client,
        repository,
        today: todayInShanghai(clock()),
        onProgress
      });
    } catch (error) {
      const message = getSafeSyncErrorMessage(error);
      await repository.setSetting('last_error', message);
      throw Object.assign(new Error(message), { statusCode: 502, expose: true, cause: error });
    }
  }

  function replan(includeToday: boolean, now = clock()): Promise<void> {
    return rebuildPlan({ repository, today: todayInShanghai(now), includeToday });
  }

  function startCollectionAction(action: () => Promise<void>): SyncStatus {
    if (pendingCollectionActions === 0) {
      collectionActionError = null;
      syncStatus = {
        state: 'running',
        startedAt: clock().toISOString(),
        completedAt: null,
        error: null,
        processedSubjects: 0,
        totalSubjects: 0,
        result: null
      };
    }
    pendingCollectionActions += 1;

    const run = collectionActionQueue.then(async () => {
      await action();
      if (syncInFlight) await syncInFlight.catch(() => undefined);
      await service.syncNow();
    });
    collectionActionQueue = run.catch(() => undefined);
    void run
      .catch((error) => {
        collectionActionError = getSafeCollectionActionError(error);
      })
      .finally(() => {
        pendingCollectionActions -= 1;
        if (pendingCollectionActions === 0 && collectionActionError) {
          syncStatus = {
            ...syncStatus,
            state: 'error',
            completedAt: clock().toISOString(),
            error: collectionActionError,
            result: null
          };
        }
      });

    return service.getSyncStatus();
  }

  async function requireSubject(subjectId: number): Promise<SubjectRow> {
    const subject = await repository.getSubject(subjectId);
    if (!subject) {
      throw Object.assign(new Error(`Subject ${subjectId} was not found`), { statusCode: 404 });
    }
    return subject;
  }

  async function completeIfEligible(subjectId: number, now: Date): Promise<void> {
    const [subject, episodes] = await Promise.all([
      repository.getSubject(subjectId),
      repository.listEpisodes()
    ]);
    if (!subject || subject.collectionType === 2) return;
    const subjectEpisodes = episodes.filter((episode) => episode.subjectId === subjectId);
    if (!canAutoComplete(subject, subjectEpisodes)) return;

    await client.setSubjectCollectionType(subjectId, 2);
    await repository.setSubjectState(subjectId, {
      collectionType: 2,
      plannerMode: subject.plannerMode,
      completedAt: now.toISOString()
    });
  }

  async function replanAfterEpisodeMutation(mutation: () => Promise<void>, now: Date, includeToday = false): Promise<void> {
    let failure: { error: unknown } | null = null;
    try {
      await mutation();
    } catch (error) {
      failure = { error };
    }
    try {
      await replan(includeToday, now);
    } catch (error) {
      if (!failure) throw error;
    }
    if (failure) throw failure.error;
  }

  async function markEpisodesWatched(subjectId: number, episodeIds: number[], now: Date): Promise<void> {
    const today = todayInShanghai(now);
    const watchedIds = new Set(episodeIds);
    const todayTaskIds = (await repository.listBacklogTasks(today, today))
      .map((task) => task.episodeId)
      .filter((episodeId) => watchedIds.has(episodeId));
    await client.markEpisodesWatched(subjectId, episodeIds);
    for (const episodeId of episodeIds) {
      await repository.markEpisodeWatched(episodeId);
    }
    for (const episodeId of todayTaskIds) {
      await repository.deleteBacklogTask(episodeId);
    }
    await replanAfterEpisodeMutation(() => completeIfEligible(subjectId, now), now);
  }

  async function clearTodayTasks(today: string): Promise<void> {
    await repository.replaceBacklogTasks({
      fromDate: today,
      throughDate: today,
      preserveLocked: false,
      tasks: []
    });
  }

  async function removeTodayTasksForSubject(subjectId: number, now: Date): Promise<boolean> {
    const today = todayInShanghai(now);
    const tasks = (await repository.listBacklogTasks(today, today))
      .filter((task) => task.subjectId === subjectId);
    for (const task of tasks) {
      await repository.deleteBacklogTask(task.episodeId);
    }
    return tasks.length > 0;
  }

  const service: DashboardService = {
    async getDashboard(): Promise<DashboardData> {
      const [episodes, subjects, lastSyncAt, lastError] = await Promise.all([
        repository.listEpisodes(),
        repository.listSubjectsByMode('seasonal', [3]),
        repository.getSetting('last_sync_at'),
        repository.getSetting('last_error')
      ]);
      const seasonalSubjectIds = new Set(subjects.map((subject) => subject.id));
      return {
        pendingEpisodes: buildReminderCandidates(
          episodes.filter((episode) => seasonalSubjectIds.has(episode.subjectId)),
          todayInShanghai(clock())
        ),
        subjects: subjects.map(compactSubject),
        lastSyncAt,
        lastError: lastError || null
      };
    },

    async getSubjectEpisodes(subjectId) {
      await requireSubject(subjectId);
      return repository.listSubjectProgressEpisodes(subjectId);
    },

    async getBacklog(): Promise<BacklogData> {
      const today = todayInShanghai(clock());
      const dates = Array.from({ length: 7 }, (_, offset) => shiftAirDate(today, offset));
      const throughDate = dates[6];
      const [tasks, seasonal, active, held, completed] = await Promise.all([
        repository.listBacklogTasks(today, throughDate),
        repository.listSubjectsByMode('seasonal', [3]),
        repository.listSubjectsByMode('backlog', [3]),
        repository.listSubjectsByMode('backlog', [4]),
        repository.listSubjectsByMode('backlog', [2])
      ]);
      const seasonalEpisodes = seasonal.flatMap((subject) => subject.mainEpisodes);
      const seasonalLoads = dates.map((date) => countSeasonalLoad(seasonalEpisodes, date));

      return {
        today,
        todayTasks: tasks.filter((task) => task.plannedDate === today),
        futureDays: dates.slice(1).map((date, index) => ({
          date,
          seasonalLoad: seasonalLoads[index + 1],
          capacity: capacityForSeasonalLoad(seasonalLoads[index + 1]),
          tasks: tasks.filter((task) => task.plannedDate === date)
        })),
        active,
        held,
        completed,
        estimatedCompletionDate: estimateBacklogCompletionDate(
          today,
          active.reduce((total, subject) => total + subject.unwatchedMainEpisodeCount, 0),
          seasonalLoads
        )
      };
    },

    async getHeldSubjects() {
      const subjects = await repository.listSubjectsByCollection([4]);
      return subjects.sort((a, b) => Number(b.plannerMode === 'seasonal') - Number(a.plannerMode === 'seasonal'));
    },

    async getWishlist(query, year) {
      const data = await repository.listWishlist(query.trim(), year);
      const today = todayInShanghai(clock());
      return {
        ...data,
        items: data.items.map((subject) => ({
          ...subject,
          isUpcoming: Boolean(subject.airDate && subject.airDate > today)
        }))
      };
    },

    async getCalendar() {
      const [days, overrides] = await Promise.all([
        client.getCalendar(),
        repository.listBroadcastOverrides()
      ]);
      return applyCalendarOverrides(days, overrides);
    },

    async getUpcomingSeason() {
      const seasonKey = nextSeasonKey(seasonKeyForDate(clock()));
      const catalog = await client.getUpcomingSeasonCatalog?.(seasonKey);
      if (!catalog?.available) return { seasonKey, available: false, items: [] };
      const queuedIds = new Set(
        parseAutoWatchQueue(await repository.getSetting('auto_watch_queue'))
          .filter((item) => item.seasonKey === seasonKey)
          .map((item) => item.subjectId)
      );
      const items = await Promise.all([...catalog.entries.values()].map(async (entry) => {
        const subject = await repository.getSubject(entry.subjectId);
        const autoWatch = queuedIds.has(entry.subjectId);
        const action = upcomingAction(subject?.collectionType ?? null, autoWatch);
        return {
          id: entry.subjectId,
          name: entry.name,
          nameCn: entry.nameCn,
          image: entry.image,
          url: `https://bgm.tv/subject/${entry.subjectId}`,
          seasonKey,
          sourceType: entry.sourceType,
          collectionType: subject?.collectionType ?? null,
          action: action.action,
          actionLabel: action.label,
          autoWatch
        };
      }));
      return { seasonKey, available: true, items };
    },

    async saveBroadcastOverride(input) {
      await repository.saveBroadcastOverride(input);
    },

    async deleteBroadcastOverride(subjectId) {
      await repository.deleteBroadcastOverride(subjectId);
    },

    async syncNow(): Promise<SyncResult> {
      if (syncInFlight) {
        return syncInFlight;
      }

      const startedAt = clock().toISOString();
      syncStatus = {
        state: 'running',
        startedAt,
        completedAt: null,
        error: null,
        processedSubjects: 0,
        totalSubjects: 0,
        result: null
      };
      syncInFlight = executeSync((progress) => {
        syncStatus = { ...syncStatus, ...progress };
      })
        .then((result) => {
          syncStatus = {
            ...syncStatus,
            state: 'idle',
            completedAt: clock().toISOString(),
            error: null,
            processedSubjects: result.subjectsSynced + (result.subjectsFailed ?? 0),
            totalSubjects: Math.max(syncStatus.totalSubjects, result.subjectsSynced + (result.subjectsFailed ?? 0)),
            result
          };
          return result;
        })
        .catch((error) => {
          syncStatus = {
            ...syncStatus,
            state: 'error',
            completedAt: clock().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            result: null
          };
          throw error;
        })
        .finally(() => {
          syncInFlight = null;
        });
      return syncInFlight;
    },

    startSync(): SyncStatus {
      void service.syncNow().catch(() => undefined);
      return service.getSyncStatus();
    },

    getSyncStatus(): SyncStatus {
      return pendingCollectionActions > 0
        ? { ...syncStatus, state: 'running', completedAt: null, error: null, result: null }
        : { ...syncStatus };
    },

    async markEpisodeWatched(episodeId) {
      const episode = await repository.getEpisode(episodeId);
      if (!episode) {
        throw new Error(`Episode ${episodeId} was not found`);
      }
      await markEpisodesWatched(episode.subjectId, [episodeId], clock());
    },

    async markEpisodeUnwatched(episodeId) {
      const episode = await repository.getEpisode(episodeId);
      if (!episode) {
        throw new Error(`Episode ${episodeId} was not found`);
      }
      const subject = await repository.getSubject(episode.subjectId);
      const now = clock();
      await client.markEpisodesUnwatched(episode.subjectId, [episodeId]);
      await repository.markEpisodeUnwatched(episodeId);
      await replanAfterEpisodeMutation(async () => {
        if (subject?.collectionType === 2) {
          await client.setSubjectCollectionType(subject.id, 3);
          await repository.setSubjectState(subject.id, {
            collectionType: 3,
            plannerMode: subject.plannerMode,
            completedAt: null
          });
        }
      }, now);
    },

    async markSubjectEpisodesWatchedThrough(subjectId, episodeId) {
      const selected = await repository.getEpisode(episodeId);
      if (!selected || selected.subjectId !== subjectId) {
        throw Object.assign(new Error(`Episode ${episodeId} was not found for subject ${subjectId}`), { statusCode: 404 });
      }
      if (selected.episodeType !== 0) {
        throw Object.assign(new Error('Only main episodes can be marked watched through'), { statusCode: 400 });
      }

      const selectedProgress = episodeProgress(selected);
      if (!Number.isFinite(selectedProgress)) {
        throw Object.assign(new Error('Selected episode does not have a valid progress number'), { statusCode: 400 });
      }

      const episodeIds = (await repository.listEpisodes())
        .filter((episode) => {
          if (episode.subjectId !== subjectId || episode.episodeType !== 0 || episode.collectionType === 2) return false;
          return episodeProgress(episode) <= selectedProgress;
        })
        .sort((a, b) => episodeProgress(a) - episodeProgress(b))
        .map((episode) => episode.id);

      if (episodeIds.length === 0) {
        return;
      }

      await markEpisodesWatched(subjectId, episodeIds, clock());
    },

    async addSubjectToWatching(subjectId) {
      return startCollectionAction(() => client.addSubjectToWatching(subjectId));
    },

    async addSubjectToWishlist(subjectId) {
      return startCollectionAction(() => client.addSubjectToWishlist(subjectId));
    },

    async addUpcomingToWishlist(subjectId) {
      return startCollectionAction(async () => {
        const seasonKey = nextSeasonKey(seasonKeyForDate(clock()));
        const catalog = await client.getUpcomingSeasonCatalog?.(seasonKey);
        if (!catalog?.entries.has(subjectId)) {
          throw Object.assign(new Error('该动画不在 Yuc 下季度新番列表或尚未由 Bangumi 确认'), { statusCode: 404 });
        }
        const subject = await repository.getSubject(subjectId);
        if (subject && subject.collectionType !== 1) {
          throw Object.assign(new Error('该动画已经有其他收藏状态'), { statusCode: 400 });
        }
        if (!subject) await client.addSubjectToWishlist(subjectId);
        await queueAutoWatchSubject(repository, { subjectId, seasonKey });
      });
    },

    async startSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (subject.collectionType !== 1) {
        throw Object.assign(new Error('Only wishlist subjects can be started'), { statusCode: 400 });
      }
      if (subject.airDate && subject.airDate > todayInShanghai(clock())) {
        throw Object.assign(new Error('尚未播出，已保留在想看'), { statusCode: 400 });
      }
      return startCollectionAction(() => client.setSubjectCollectionType(subjectId, 3));
    },

    async holdSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (!subject.plannerMode || subject.collectionType !== 3) {
        throw Object.assign(new Error('Only active planning subjects can be held'), { statusCode: 400 });
      }
      await client.setSubjectCollectionType(subjectId, 4);
      await repository.setSubjectState(subjectId, {
        collectionType: 4,
        plannerMode: subject.plannerMode,
        completedAt: null
      });
      const now = clock();
      await replan(await removeTodayTasksForSubject(subjectId, now), now);
    },

    async resumeHeldSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (!subject.plannerMode || subject.collectionType !== 4) {
        throw Object.assign(new Error('Only held planning subjects can be resumed'), { statusCode: 400 });
      }
      await client.setSubjectCollectionType(subjectId, 3);
      await repository.setSubjectState(subjectId, {
        collectionType: 3,
        plannerMode: subject.plannerMode,
        completedAt: null
      });
      await replan(false);
    },

    async dropSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (!subject.plannerMode || ![3, 4].includes(subject.collectionType)) {
        throw Object.assign(new Error('Only active or held planning subjects can be dropped'), { statusCode: 400 });
      }
      await client.setSubjectCollectionType(subjectId, 5);
      await repository.setSubjectState(subjectId, {
        collectionType: 5,
        plannerMode: subject.plannerMode,
        completedAt: null
      });
      const now = clock();
      await replan(await removeTodayTasksForSubject(subjectId, now), now);
    },

    async pauseBacklogSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (subject.plannerMode !== 'backlog' || subject.collectionType !== 3) {
        throw Object.assign(new Error('Only active backlog subjects can be paused'), { statusCode: 400 });
      }
      await service.holdSubject(subjectId);
    },

    async resumeBacklogSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (subject.plannerMode !== 'backlog' || subject.collectionType !== 4) {
        throw Object.assign(new Error('Only held backlog subjects can be resumed'), { statusCode: 400 });
      }
      await service.resumeHeldSubject(subjectId);
    },

    async completeBacklogSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (subject.plannerMode !== 'backlog' || ![3, 4].includes(subject.collectionType)) {
        throw Object.assign(new Error('Only unfinished backlog subjects can be completed manually'), { statusCode: 400 });
      }
      if (subject.totalEpisodesKnown) {
        throw Object.assign(new Error('Manual completion is only available when the episode total is unknown'), { statusCode: 400 });
      }
      const now = clock();
      await client.setSubjectCollectionType(subjectId, 2);
      await repository.setSubjectState(subjectId, {
        collectionType: 2,
        plannerMode: subject.plannerMode,
        completedAt: now.toISOString()
      });
      await replan(await removeTodayTasksForSubject(subjectId, now), now);
    },

    async swapBacklogTask(episodeId) {
      const now = clock();
      const today = todayInShanghai(now);
      const todayTasks = await repository.listBacklogTasks(today, today);
      if (!todayTasks.some((task) => task.episodeId === episodeId)) {
        throw Object.assign(new Error(`Episode ${episodeId} is not in today's backlog plan`), { statusCode: 404 });
      }
      await repository.deleteBacklogTask(episodeId);
      await repository.excludeEpisodeOnDate(today, episodeId);
      await replan(true, now);
    },

    async skipBacklogToday() {
      const now = clock();
      const today = todayInShanghai(now);
      await repository.skipBacklogDate(today);
      await clearTodayTasks(today);
      await replan(true, now);
    },

    async replanBacklogToday() {
      const now = clock();
      const today = todayInShanghai(now);
      await repository.clearBacklogDateOverrides(today);
      await clearTodayTasks(today);
      await replan(true, now);
    },

    async searchAnimeSubjects(keyword) {
      const trimmed = keyword.trim();
      if (!trimmed) {
        return [];
      }
      const results = await client.searchAnimeSubjects(trimmed);
      const today = todayInShanghai(clock());
      return Promise.all(results.map(async (result) => {
        const subject = await repository.getSubject(result.id);
        return {
          ...result,
          collectionType: subject?.collectionType ?? null,
          ...getAnimeSearchWatchAction(result, subject, today),
          ...getAnimeSearchWishlistAction(subject)
        };
      }));
    },

    async dismissEpisode(episodeId) {
      const episode = await repository.getEpisode(episodeId);
      if (!episode) {
        throw Object.assign(new Error(`Episode ${episodeId} was not found`), { statusCode: 404 });
      }
      await repository.dismissEpisode(episodeId, `${todayInShanghai(clock())}T00:00:00+08:00`);
    },

    async snoozeEpisodeUntilTomorrow(episodeId) {
      const episode = await repository.getEpisode(episodeId);
      if (!episode) {
        throw Object.assign(new Error(`Episode ${episodeId} was not found`), { statusCode: 404 });
      }
      const subject = await repository.getSubject(episode.subjectId);
      if (!subject || subject.plannerMode !== 'seasonal' || subject.collectionType !== 3) {
        throw Object.assign(new Error('Only seasonal reminders can be snoozed'), { statusCode: 400 });
      }
      const today = todayInShanghai(clock());
      if (buildReminderCandidates([episode], today).length !== 1) {
        throw Object.assign(new Error('Only pending reminders can be snoozed'), { statusCode: 400 });
      }
      await repository.snoozeEpisodeUntil(episodeId, shiftAirDate(today, 1));
    }
  };

  return service;
}

export function canAutoComplete(subject: SubjectRow, episodes: EpisodeRow[]): boolean {
  if (!subject.totalEpisodesKnown || subject.eps <= 0) return false;
  const watchedProgress = new Set(
    progressEpisodesFor(subject, episodes)
      .filter((episode) => episode.collectionType === 2)
      .map(episodeProgress)
      .filter((progress) => Number.isInteger(progress) && progress > 0 && progress <= subject.eps)
  );
  return watchedProgress.size === subject.eps;
}

function getAnimeSearchWatchAction(result: { airDate: string }, subject: SubjectRow | null, today: string) {
  if (!subject) {
    return result.airDate && result.airDate > today
      ? { watchAction: null, watchActionLabel: '尚未播出' }
      : { watchAction: 'add' as const, watchActionLabel: '加入补番' };
  }
  if (subject.collectionType === 2) return { watchAction: null, watchActionLabel: '已看过' };
  if (subject.collectionType === 3) return { watchAction: null, watchActionLabel: '已在看' };
  if (subject.collectionType === 4) return {
    watchAction: 'resume' as const,
    watchActionLabel: subject.plannerMode === 'seasonal' ? '恢复追番' : '恢复补番'
  };
  if (subject.collectionType === 5) return { watchAction: null, watchActionLabel: '已抛弃' };
  if (subject.airDate && subject.airDate > today) return { watchAction: null, watchActionLabel: '尚未播出' };
  return {
    watchAction: 'start' as const,
    watchActionLabel: subject.seasonKey ? '开始追番' : '加入补番'
  };
}

function getAnimeSearchWishlistAction(subject: SubjectRow | null) {
  if (!subject) return { wishlistAction: 'add' as const, wishlistActionLabel: '加入想看' };
  if (subject.collectionType === 1) return { wishlistAction: null, wishlistActionLabel: '已在想看' };
  if (subject.collectionType === 2) return { wishlistAction: null, wishlistActionLabel: '已看过' };
  if (subject.collectionType === 3) return { wishlistAction: null, wishlistActionLabel: '已在看' };
  if (subject.collectionType === 4) return { wishlistAction: null, wishlistActionLabel: '已搁置' };
  return { wishlistAction: null, wishlistActionLabel: '已抛弃' };
}

function upcomingAction(collectionType: SubjectRow['collectionType'] | null, autoWatch: boolean) {
  if (autoWatch) return { action: null, label: '已安排开季在看' };
  if (collectionType === null) return { action: 'add' as const, label: '加入想看' };
  if (collectionType === 1) return { action: 'schedule' as const, label: '开季自动在看' };
  if (collectionType === 2) return { action: null, label: '已看过' };
  if (collectionType === 3) return { action: null, label: '已在看' };
  if (collectionType === 4) return { action: null, label: '已搁置' };
  return { action: null, label: '已抛弃' };
}

function parseAutoWatchQueue(value: string | null): Array<{ subjectId: number; seasonKey: string }> {
  try {
    const parsed = JSON.parse(value ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is { subjectId: number; seasonKey: string } => Boolean(
      item && typeof item === 'object'
      && Number.isInteger((item as { subjectId?: unknown }).subjectId)
      && /^\d{4}Q[1-4]$/.test(String((item as { seasonKey?: unknown }).seasonKey ?? ''))
    ));
  } catch {
    return [];
  }
}

export function applyCalendarOverrides(days: CalendarDay[], overrides: BroadcastOverride[]): CalendarDay[] {
  if (overrides.length === 0) return days;
  const bySubject = new Map(overrides.map((override) => [override.subjectId, override]));
  const result = days.map((day) => ({ ...day, items: [] as CalendarDay['items'] }));
  const byWeekday = new Map(result.map((day) => [day.weekday.id, day]));

  for (const day of days) {
    for (const item of day.items) {
      const override = bySubject.get(item.id);
      if (!override) {
        (byWeekday.get(day.weekday.id) ?? result[0]).items.push(item);
        continue;
      }
      const corrected = {
        ...item,
        airDate: item.airDate ? shiftAirDate(item.airDate, override.dateShiftDays) : override.airDate,
        airTime: override.airTime,
        baseScheduleSource: item.scheduleSource ?? 'Bangumi',
        scheduleSource: '本地修正' as const,
        isLocalOverride: true,
        localDateShiftDays: override.dateShiftDays
      };
      const weekday = weekdayFromDate(corrected.airDate) ?? day.weekday.id;
      (byWeekday.get(weekday) ?? result[0]).items.push(corrected);
    }
  }
  return result;
}

function weekdayFromDate(dateString: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay() || 7;
}

function compactSubject({
  mainEpisodes: _mainEpisodes,
  progressEpisodes: _progressEpisodes,
  unwatchedMainEpisodes: _unwatchedMainEpisodes,
  ...subject
}: DashboardSubject): DashboardSubjectSummary {
  void _mainEpisodes;
  void _progressEpisodes;
  void _unwatchedMainEpisodes;
  return subject;
}

function getSafeSyncErrorMessage(error: unknown): string {
  if (error instanceof BangumiApiError) {
    return 'Bangumi 同步暂时失败，请稍后再试';
  }
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return 'Bangumi 同步暂时失败，请稍后再试';
  }
  return 'Bangumi 同步失败，请稍后再试';
}

function getSafeCollectionActionError(error: unknown): string {
  if (error instanceof BangumiApiError || error instanceof TypeError) {
    return 'Bangumi 收藏更新失败，请稍后再试';
  }
  return error instanceof Error ? error.message : 'Bangumi 收藏更新失败，请稍后再试';
}

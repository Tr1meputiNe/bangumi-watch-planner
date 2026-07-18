import { buildReminderCandidates, todayInShanghai } from './reminders.js';
import { capacityForSeasonalLoad, countSeasonalLoad, estimateBacklogCompletionDate } from './backlog-planner.js';
import { shiftAirDate } from './broadcast-schedule.js';
import { rebuildBacklogPlan, syncAnimeCollections } from './sync.js';
import { BangumiApiError } from './bangumi-client.js';
import type {
  BacklogData,
  BangumiClient,
  DashboardData,
  DashboardService,
  EpisodeRow,
  OAuthManager,
  SubjectRow,
  SyncResult
} from './types.js';
import type { Repository } from './db.js';

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

  async function executeSync(): Promise<SyncResult> {
    const status = await auth.getAuthStatus();
    if (!status.username) {
      throw Object.assign(new Error('Bangumi is not connected'), { statusCode: 400, expose: true });
    }

    try {
      return await syncCollections({
        username: status.username,
        client,
        repository,
        today: todayInShanghai(clock())
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

  async function replanAfterEpisodeMutation(mutation: () => Promise<void>, now: Date): Promise<void> {
    let failure: { error: unknown } | null = null;
    try {
      await mutation();
    } catch (error) {
      failure = { error };
    }
    try {
      await replan(false, now);
    } catch (error) {
      if (!failure) throw error;
    }
    if (failure) throw failure.error;
  }

  async function markEpisodesWatched(subjectId: number, episodeIds: number[], now: Date): Promise<void> {
    await client.markEpisodesWatched(subjectId, episodeIds);
    for (const episodeId of episodeIds) {
      await repository.markEpisodeWatched(episodeId);
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
        subjects,
        lastSyncAt,
        lastError: lastError || null
      };
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

    getWishlist(query, year) {
      return repository.listWishlist(query.trim(), year);
    },

    getCalendar() {
      return client.getCalendar();
    },

    async syncNow(): Promise<SyncResult> {
      if (syncInFlight) {
        return syncInFlight;
      }

      syncInFlight = executeSync().finally(() => {
        syncInFlight = null;
      });
      return syncInFlight;
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
      await client.addSubjectToWatching(subjectId);
      return service.syncNow();
    },

    async startSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (subject.collectionType !== 1) {
        throw Object.assign(new Error('Only wishlist subjects can be started'), { statusCode: 400 });
      }
      await client.setSubjectCollectionType(subjectId, 3);
      return service.syncNow();
    },

    async pauseBacklogSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (subject.plannerMode !== 'backlog' || subject.collectionType !== 3) {
        throw Object.assign(new Error('Only active backlog subjects can be paused'), { statusCode: 400 });
      }
      await client.setSubjectCollectionType(subjectId, 4);
      await repository.setSubjectState(subjectId, {
        collectionType: 4,
        plannerMode: 'backlog',
        completedAt: null
      });
      await replan(false);
    },

    async resumeBacklogSubject(subjectId) {
      const subject = await requireSubject(subjectId);
      if (subject.plannerMode !== 'backlog' || subject.collectionType !== 4) {
        throw Object.assign(new Error('Only held backlog subjects can be resumed'), { statusCode: 400 });
      }
      await client.setSubjectCollectionType(subjectId, 3);
      await repository.setSubjectState(subjectId, {
        collectionType: 3,
        plannerMode: 'backlog',
        completedAt: null
      });
      await replan(false);
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
      await replan(false, now);
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
      return client.searchAnimeSubjects(trimmed);
    },

    async dismissEpisode(episodeId) {
      const episode = await repository.getEpisode(episodeId);
      if (!episode) {
        throw Object.assign(new Error(`Episode ${episodeId} was not found`), { statusCode: 404 });
      }
      await repository.dismissEpisode(episodeId, `${todayInShanghai(clock())}T00:00:00+08:00`);
    }
  };

  return service;
}

export function canAutoComplete(subject: SubjectRow, episodes: EpisodeRow[]): boolean {
  if (!subject.totalEpisodesKnown || subject.eps <= 0) return false;
  const main = episodes.filter((episode) => episode.episodeType === 0);
  return main.length >= subject.eps && main.every((episode) => episode.collectionType === 2);
}

function episodeProgress(episode: { ep: number | null; sort: number }): number {
  return Number(episode.ep ?? episode.sort);
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

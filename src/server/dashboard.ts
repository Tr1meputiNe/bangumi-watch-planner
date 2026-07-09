import { buildReminderCandidates, todayInShanghai } from './reminders.js';
import { syncWatchingAnime } from './sync.js';
import { BangumiApiError } from './bangumi-client.js';
import type { BangumiClient, DashboardData, DashboardService, OAuthManager, SyncResult } from './types.js';
import type { Repository } from './db.js';

type DashboardDeps = {
  auth: OAuthManager;
  client: BangumiClient;
  repository: Repository;
};

export function createDashboardService({ auth, client, repository }: DashboardDeps): DashboardService {
  let syncInFlight: Promise<SyncResult> | null = null;

  async function executeSync(): Promise<SyncResult> {
    const status = await auth.getAuthStatus();
    if (!status.username) {
      throw Object.assign(new Error('Bangumi is not connected'), { statusCode: 400, expose: true });
    }

    try {
      return await syncWatchingAnime({ username: status.username, client, repository });
    } catch (error) {
      const message = getSafeSyncErrorMessage(error);
      await repository.setSetting('last_error', message);
      throw Object.assign(new Error(message), { statusCode: 502, expose: true, cause: error });
    }
  }

  const service: DashboardService = {
    async getDashboard(): Promise<DashboardData> {
      const [episodes, subjects, lastSyncAt, lastError] = await Promise.all([
        repository.listEpisodes(),
        repository.listSubjects(),
        repository.getSetting('last_sync_at'),
        repository.getSetting('last_error')
      ]);
      return {
        pendingEpisodes: buildReminderCandidates(episodes),
        subjects,
        lastSyncAt,
        lastError: lastError || null
      };
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
      await client.markEpisodesWatched(episode.subjectId, [episodeId]);
      await repository.markEpisodeWatched(episodeId);
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

      await client.markEpisodesWatched(subjectId, episodeIds);
      for (const id of episodeIds) {
        await repository.markEpisodeWatched(id);
      }
    },

    async addSubjectToWatching(subjectId) {
      await client.addSubjectToWatching(subjectId);
      return service.syncNow();
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
      await repository.dismissEpisode(episodeId, `${todayInShanghai()}T00:00:00+08:00`);
    }
  };

  return service;
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

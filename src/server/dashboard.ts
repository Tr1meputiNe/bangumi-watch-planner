import { buildReminderCandidates, todayInShanghai } from './reminders.js';
import { syncWatchingAnime } from './sync.js';
import type { BangumiClient, DashboardData, DashboardService, OAuthManager, SyncResult } from './types.js';
import type { Repository } from './db.js';

type DashboardDeps = {
  auth: OAuthManager;
  client: BangumiClient;
  repository: Repository;
};

export function createDashboardService({ auth, client, repository }: DashboardDeps): DashboardService {
  return {
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

    async syncNow(): Promise<SyncResult> {
      const status = await auth.getAuthStatus();
      if (!status.username) {
        throw new Error('Bangumi is not connected');
      }

      try {
        return await syncWatchingAnime({ username: status.username, client, repository });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await repository.setSetting('last_error', message);
        throw error;
      }
    },

    async markEpisodeWatched(episodeId) {
      const episode = await repository.getEpisode(episodeId);
      if (!episode) {
        throw new Error(`Episode ${episodeId} was not found`);
      }
      await client.markEpisodesWatched(episode.subjectId, [episodeId]);
      await repository.markEpisodeWatched(episodeId);
    },

    async dismissEpisode(episodeId) {
      const episode = await repository.getEpisode(episodeId);
      if (!episode) {
        throw Object.assign(new Error(`Episode ${episodeId} was not found`), { statusCode: 404 });
      }
      await repository.dismissEpisode(episodeId, `${todayInShanghai()}T00:00:00+08:00`);
    }
  };
}

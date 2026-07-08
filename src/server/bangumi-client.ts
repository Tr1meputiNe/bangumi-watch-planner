import type { BangumiClient, BangumiCollectionPage, BangumiEpisodePage, BangumiUser } from './types.js';

type BangumiClientDeps = {
  fetch?: typeof fetch;
  getAccessToken: () => Promise<string>;
  userAgent: string;
};

const API_BASE = 'https://api.bgm.tv';

export function createBangumiClient(deps: BangumiClientDeps): BangumiClient {
  const fetchImpl = deps.fetch ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await deps.getAccessToken();
    const response = await fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'User-Agent': deps.userAgent,
        Authorization: `Bearer ${token}`,
        ...init.headers
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Bangumi API ${response.status}: ${body || path}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  return {
    getMe() {
      return request<BangumiUser>('/v0/me');
    },

    getWatchingAnime(username, limit, offset) {
      const params = new URLSearchParams({
        subject_type: '2',
        type: '3',
        limit: String(limit),
        offset: String(offset)
      });
      return request<BangumiCollectionPage>(`/v0/users/${encodeURIComponent(username)}/collections?${params}`);
    },

    getSubjectEpisodes(subjectId, limit = 1000, offset = 0) {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset)
      });
      return request<BangumiEpisodePage>(`/v0/users/-/collections/${subjectId}/episodes?${params}`);
    },

    async markEpisodesWatched(subjectId, episodeIds) {
      await request<void>(`/v0/users/-/collections/${subjectId}/episodes`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ episode_id: episodeIds, type: 2 })
      });
    }
  };
}

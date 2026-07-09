import type {
  AnimeSearchResult,
  BangumiClient,
  BangumiCollectionPage,
  BangumiEpisodePage,
  BangumiSubjectSearchPage,
  BangumiUser
} from './types.js';

type BangumiClientDeps = {
  fetch?: typeof fetch;
  getAccessToken: () => Promise<string>;
  userAgent: string;
  maxRetries?: number;
  retryDelayMs?: number;
};

const API_BASE = 'https://api.bgm.tv';
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class BangumiApiError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BangumiApiError';
  }
}

export function createBangumiClient(deps: BangumiClientDeps): BangumiClient {
  const fetchImpl = deps.fetch ?? fetch;
  const maxRetries = deps.maxRetries ?? 2;
  const retryDelayMs = deps.retryDelayMs ?? 350;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await deps.getAccessToken();
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
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
          if (TRANSIENT_STATUS_CODES.has(response.status) && attempt < maxRetries) {
            await delay(retryDelayMs * (attempt + 1));
            continue;
          }
          const body = await response.text().catch(() => '');
          throw new BangumiApiError(`Bangumi API ${response.status}: ${body || path}`, response.status);
        }

        if (response.status === 204) {
          return undefined as T;
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        if (error instanceof BangumiApiError || attempt >= maxRetries) {
          break;
        }
        await delay(retryDelayMs * (attempt + 1));
      }
    }

    if (lastError instanceof BangumiApiError) throw lastError;

    throw new BangumiApiError('Bangumi API request failed', 502, lastError);
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
    },

    async addSubjectToWatching(subjectId) {
      await request<void>(`/v0/users/-/collections/${subjectId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ type: 3 })
      });
    },

    async searchAnimeSubjects(keyword) {
      const params = new URLSearchParams({
        limit: '8',
        offset: '0'
      });
      const page = await request<BangumiSubjectSearchPage>(`/v0/search/subjects?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ keyword, sort: 'match', filter: { type: [2] } })
      });
      return page.data.map(mapSearchResult);
    }
  };
}

function mapSearchResult(subject: BangumiSubjectSearchPage['data'][number]): AnimeSearchResult {
  return {
    id: subject.id,
    name: subject.name,
    nameCn: subject.name_cn ?? '',
    eps: subject.eps ?? 0,
    image: subject.images?.common ?? subject.images?.medium ?? subject.images?.small ?? null,
    url: `https://bgm.tv/subject/${subject.id}`
  };
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

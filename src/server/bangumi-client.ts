import type {
  AnimeSearchResult,
  BangumiCalendarDay,
  BangumiClient,
  BangumiCollectionPage,
  BangumiEpisodePage,
  BangumiSubjectSearchPage,
  BangumiUser,
  CalendarDay
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
type RequestOptions = {
  auth?: boolean;
};

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

  async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
    const token = options.auth === false ? null : await deps.getAccessToken();
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetchImpl(`${API_BASE}${path}`, {
          ...init,
          headers: {
            Accept: 'application/json',
            'User-Agent': deps.userAgent,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

    async getCalendar() {
      const days = await request<BangumiCalendarDay[]>('/calendar', {}, { auth: false });
      return days.map(mapCalendarDay);
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

function mapCalendarDay(day: BangumiCalendarDay): CalendarDay {
  return {
    weekday: day.weekday,
    items: day.items.map((item) => ({
      id: item.id,
      name: item.name,
      nameCn: item.name_cn ?? '',
      url: normalizeBangumiUrl(item.url ?? `https://bgm.tv/subject/${item.id}`),
      airDate: item.air_date ?? '',
      airWeekday: typeof item.air_weekday === 'number' ? item.air_weekday : null,
      image: item.images?.common ?? item.images?.medium ?? item.images?.small ?? item.images?.grid ?? null,
      ratingScore: typeof item.rating?.score === 'number' ? item.rating.score : null,
      rank: typeof item.rank === 'number' ? item.rank : null,
      collectionDoing: typeof item.collection?.doing === 'number' ? item.collection.doing : null
    }))
  };
}

function normalizeBangumiUrl(url: string): string {
  return url.replace(/^http:\/\/bgm\.tv\//, 'https://bgm.tv/');
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

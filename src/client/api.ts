import type { AnimeSearchResult, AuthStatus, BacklogData, CalendarDay, DashboardData, DashboardSubject, EpisodeRow, SyncStatus, UpcomingSeasonData, WishlistData } from '../server/types.js';

async function api<T>(input: RequestInfo | URL, init?: RequestInit, retryOnInvalidToken = true): Promise<T> {
  const headers = new Headers(init?.headers);
  const headerEntries = [...headers.entries()];
  const requestInit = headerEntries.length > 0 ? { ...init, headers: Object.fromEntries(headerEntries) } : init;
  const response = await request(input, requestInit);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as unknown;
    const bodyError = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
    if (isInvalidLocalToken(response, { error: bodyError }) && retryOnInvalidToken && init?.method && init.method !== 'GET') {
      await refreshApiToken();
      return api<T>(input, init, false);
    }
    const message = typeof bodyError === 'string' && bodyError.trim()
      ? bodyError
      : response.statusText || `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return init ? await fetch(input, init) : await fetch(input);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('无法连接本机服务，请确认应用仍在运行后重试。');
    }
    throw error;
  }
}

function isInvalidLocalToken(response: Response, body: { error?: unknown }): boolean {
  return response.status === 403 && typeof body.error === 'string' && body.error.includes('Invalid local API token');
}

async function refreshApiToken(): Promise<void> {
  const response = await request('/api/auth/status');
  if (!response.ok) {
    return;
  }
  await response.json();
}

export function getAuthStatus(): Promise<AuthStatus> {
  return api<AuthStatus>('/api/auth/status');
}

export function getDashboard(): Promise<DashboardData> {
  return api<DashboardData>('/api/dashboard');
}

export async function getSubjectEpisodes(subjectId: number): Promise<EpisodeRow[]> {
  const response = await api<{ episodes: EpisodeRow[] }>(`/api/subjects/${subjectId}/episodes`);
  return response.episodes;
}

export function getBacklog(): Promise<BacklogData> {
  return api<BacklogData>('/api/backlog');
}

export function getHeldSubjects(): Promise<DashboardSubject[]> {
  return api<DashboardSubject[]>('/api/held');
}

export function getWishlist(query: string, year: number | null | 'unknown'): Promise<WishlistData> {
  const params = new URLSearchParams({ q: query, year: year === null ? 'all' : String(year) });
  return api<WishlistData>(`/api/wishlist?${params}`);
}

export function getCalendar(): Promise<CalendarDay[]> {
  return api<CalendarDay[]>('/api/calendar');
}

export function getUpcomingSeason(): Promise<UpcomingSeasonData> {
  return api<UpcomingSeasonData>('/api/upcoming-season');
}

export function saveBroadcastOverride(
  subjectId: number,
  input: { airDate: string; airTime: string; dateShiftDays: number }
): Promise<void> {
  return api<void>(`/api/broadcast-overrides/${subjectId}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(input)
  });
}

export function deleteBroadcastOverride(subjectId: number): Promise<void> {
  return api<void>(`/api/broadcast-overrides/${subjectId}`, { method: 'DELETE' });
}

export function startSync(): Promise<SyncStatus> {
  return api<SyncStatus>('/api/sync', { method: 'POST' });
}

export function getSyncStatus(): Promise<SyncStatus> {
  return api<SyncStatus>('/api/sync/status');
}

export function saveOAuthConfig(clientId: string, clientSecret: string): Promise<void> {
  return api<void>('/api/settings/oauth', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ clientId, clientSecret })
  });
}

export function markWatched(episodeId: number): Promise<void> {
  return api<void>(`/api/episodes/${episodeId}/watched`, { method: 'POST' });
}

export function markUnwatched(episodeId: number): Promise<void> {
  return api<void>(`/api/episodes/${episodeId}/unwatched`, { method: 'POST' });
}

export function markWatchedThrough(subjectId: number, episodeId: number): Promise<void> {
  return api<void>(`/api/subjects/${subjectId}/watched-through`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ episodeId })
  });
}

export async function searchAnime(keyword: string): Promise<AnimeSearchResult[]> {
  const response = await api<{ results: AnimeSearchResult[] }>(`/api/search/anime?q=${encodeURIComponent(keyword)}`);
  return response.results;
}

export function addSubjectToWatching(subjectId: number): Promise<SyncStatus> {
  return api<SyncStatus>(`/api/subjects/${subjectId}/watching`, { method: 'POST' });
}

export function addSubjectToWishlist(subjectId: number): Promise<SyncStatus> {
  return api<SyncStatus>(`/api/subjects/${subjectId}/wishlist`, { method: 'POST' });
}

export function addUpcomingToWishlist(subjectId: number): Promise<SyncStatus> {
  return api<SyncStatus>(`/api/upcoming-season/${subjectId}/wishlist`, { method: 'POST' });
}

export function startSubject(subjectId: number): Promise<SyncStatus> {
  return api<SyncStatus>(`/api/subjects/${subjectId}/start`, { method: 'POST' });
}

export function holdSubject(subjectId: number): Promise<void> {
  return api<void>(`/api/subjects/${subjectId}/hold`, { method: 'POST' });
}

export function resumeHeldSubject(subjectId: number): Promise<void> {
  return api<void>(`/api/subjects/${subjectId}/resume`, { method: 'POST' });
}

export function dropSubject(subjectId: number): Promise<void> {
  return api<void>(`/api/subjects/${subjectId}/drop`, { method: 'POST' });
}

export function pauseBacklog(subjectId: number): Promise<void> {
  return api<void>(`/api/backlog/${subjectId}/pause`, { method: 'POST' });
}

export function resumeBacklog(subjectId: number): Promise<void> {
  return api<void>(`/api/backlog/${subjectId}/resume`, { method: 'POST' });
}

export function completeBacklog(subjectId: number): Promise<void> {
  return api<void>(`/api/backlog/${subjectId}/complete`, { method: 'POST' });
}

export function swapBacklogTask(episodeId: number): Promise<void> {
  return api<void>(`/api/backlog/tasks/${episodeId}/swap`, { method: 'POST' });
}

export function skipBacklogToday(): Promise<void> {
  return api<void>('/api/backlog/today/skip', { method: 'POST' });
}

export function replanBacklogToday(): Promise<void> {
  return api<void>('/api/backlog/today/replan', { method: 'POST' });
}

export function dismissReminder(episodeId: number): Promise<void> {
  return api<void>(`/api/reminders/${episodeId}/dismiss`, { method: 'POST' });
}

export function snoozeReminderUntilTomorrow(episodeId: number): Promise<void> {
  return api<void>(`/api/reminders/${episodeId}/tomorrow`, { method: 'POST' });
}

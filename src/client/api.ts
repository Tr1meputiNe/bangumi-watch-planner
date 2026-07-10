import type { AnimeSearchResult, AuthStatus, CalendarDay, DashboardData, SyncResult } from '../server/types.js';

async function api<T>(input: RequestInfo | URL, init?: RequestInit, retryOnInvalidToken = true): Promise<T> {
  const headers = new Headers(init?.headers);
  const headerEntries = [...headers.entries()];
  const requestInit = headerEntries.length > 0 ? { ...init, headers: Object.fromEntries(headerEntries) } : init;
  const response = await fetch(input, requestInit);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    if (isInvalidLocalToken(response, body) && retryOnInvalidToken && init?.method && init.method !== 'GET') {
      await refreshApiToken();
      return api<T>(input, init, false);
    }
    throw new Error(body.error || response.statusText);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function isInvalidLocalToken(response: Response, body: { error?: unknown }): boolean {
  return response.status === 403 && typeof body.error === 'string' && body.error.includes('Invalid local API token');
}

async function refreshApiToken(): Promise<void> {
  const response = await fetch('/api/auth/status');
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

export function getCalendar(): Promise<CalendarDay[]> {
  return api<CalendarDay[]>('/api/calendar');
}

export function syncNow(): Promise<SyncResult> {
  return api<SyncResult>('/api/sync', { method: 'POST' });
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

export function addSubjectToWatching(subjectId: number): Promise<SyncResult> {
  return api<SyncResult>(`/api/subjects/${subjectId}/watching`, { method: 'POST' });
}

export function dismissReminder(episodeId: number): Promise<void> {
  return api<void>(`/api/reminders/${episodeId}/dismiss`, { method: 'POST' });
}

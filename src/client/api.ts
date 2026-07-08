import type { AuthStatus, DashboardData } from '../server/types.js';

let apiToken: string | null = null;

export function setApiToken(value: string | null | undefined): void {
  apiToken = value ?? null;
}

async function api<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (apiToken && init?.method && init.method !== 'GET') {
    headers.set('x-bwp-token', apiToken);
  }
  const headerEntries = [...headers.entries()];
  const response = await fetch(input, { ...init, headers: headerEntries.length > 0 ? Object.fromEntries(headerEntries) : undefined });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function getAuthStatus(): Promise<AuthStatus> {
  return api<AuthStatus>('/api/auth/status');
}

export function getDashboard(): Promise<DashboardData> {
  return api<DashboardData>('/api/dashboard');
}

export function syncNow(): Promise<void> {
  return api<void>('/api/sync', { method: 'POST' });
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

export function dismissReminder(episodeId: number): Promise<void> {
  return api<void>(`/api/reminders/${episodeId}/dismiss`, { method: 'POST' });
}

// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App.js';

const dashboard = {
  pendingEpisodes: [
    {
      id: 11,
      subjectId: 1,
      subjectName: 'テスト番組',
      subjectNameCn: '测试番剧',
      subjectUrl: 'https://bgm.tv/subject/1',
      episodeType: 0,
      sort: 1,
      ep: 1,
      name: 'first',
      nameCn: '第一集',
      airdate: '2026-07-08',
      collectionType: 0,
      dismissedAt: null
    }
  ],
  subjects: [
    {
      id: 1,
      name: 'テスト番組',
      nameCn: '测试番剧',
      eps: 12,
      epStatus: 1,
      image: 'cover.jpg',
      url: 'https://bgm.tv/subject/1',
      nextEpisode: {
        id: 11,
        subjectId: 1,
        subjectName: 'テスト番組',
        subjectNameCn: '测试番剧',
        subjectUrl: 'https://bgm.tv/subject/1',
        episodeType: 0,
        sort: 1,
        ep: 1,
        name: 'first',
        nameCn: '第一集',
        airdate: '2026-07-08',
        collectionType: 0,
        dismissedAt: null
      }
    }
  ],
  lastSyncAt: '2026-07-08T20:00:00+08:00',
  lastError: null
};

describe('App', () => {
  it('renders pending episodes and can mark one watched', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt,
          apiToken: 'client-token'
        });
      }
      if (url === '/api/dashboard') {
        return Response.json(dashboard);
      }
      if (url === '/api/episodes/11/watched' && init?.method === 'POST') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findAllByText('测试番剧')).toHaveLength(2);
    expect(screen.getByText('第一集')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '标记看过' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/episodes/11/watched', {
        method: 'POST',
        headers: { 'x-bwp-token': 'client-token' }
      });
    });
  });

  it('refreshes the local API token and retries writes when the server token changed', async () => {
    let authCalls = 0;
    let watchedCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        authCalls += 1;
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt,
          apiToken: authCalls === 1 ? 'old-token' : 'new-token'
        });
      }
      if (url === '/api/dashboard') {
        return Response.json(dashboard);
      }
      if (url === '/api/episodes/11/watched' && init?.method === 'POST') {
        watchedCalls += 1;
        if (watchedCalls === 1) {
          return Response.json({ error: 'Invalid local API token' }, { status: 403 });
        }
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('第一集');
    await userEvent.click(screen.getByRole('button', { name: '标记看过' }));

    await waitFor(() => {
      expect(watchedCalls).toBe(2);
    });
    const watchedRequests = fetchMock.mock.calls.filter(([input]) => input.toString() === '/api/episodes/11/watched');
    expect(watchedRequests[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'x-bwp-token': 'old-token' }
    });
    expect(watchedRequests[1][1]).toMatchObject({
      method: 'POST',
      headers: { 'x-bwp-token': 'new-token' }
    });
  });

  it('shows a login action when Bangumi is not connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (input.toString() === '/api/auth/status') {
          return Response.json({ authenticated: false, username: null, nickname: null, lastSyncAt: null });
        }
        if (input.toString() === '/api/dashboard') {
          return Response.json({ pendingEpisodes: [], subjects: [], lastSyncAt: null, lastError: null });
        }
        throw new Error(`Unexpected request ${input.toString()}`);
      })
    );

    render(<App />);

    expect(await screen.findByRole('link', { name: '连接 Bangumi' })).toHaveAttribute('href', '/auth/login');
  });

  it('lets the user save Bangumi OAuth config inside the app', async () => {
    let oauthConfigured = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: false,
          username: null,
          nickname: null,
          lastSyncAt: null,
          configured: oauthConfigured,
          callbackUrl: 'http://127.0.0.1:3777/auth/callback',
          oauthClientId: oauthConfigured ? 'client-id' : null,
          apiToken: 'client-token'
        });
      }
      if (url === '/api/dashboard') {
        return Response.json({ pendingEpisodes: [], subjects: [], lastSyncAt: null, lastError: null });
      }
      if (url === '/api/settings/oauth' && init?.method === 'POST') {
        oauthConfigured = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('link', { name: '打开 Bangumi 开发者平台' })).toHaveAttribute('href', 'https://bgm.tv/dev');
    expect(screen.getByText('http://127.0.0.1:3777/auth/callback')).toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText('Bangumi App ID'), 'client-id');
    await userEvent.type(screen.getByLabelText('Bangumi App Secret'), 'client-secret');
    await userEvent.click(screen.getByRole('button', { name: '保存 OAuth 配置' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/settings/oauth', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bwp-token': 'client-token'
        },
        body: JSON.stringify({ clientId: 'client-id', clientSecret: 'client-secret' })
      });
    });
    expect(await screen.findByRole('link', { name: '连接 Bangumi' })).toHaveAttribute('href', '/auth/login');
  });
});

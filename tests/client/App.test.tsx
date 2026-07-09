// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
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
      unwatchedMainEpisodeCount: 1,
      unwatchedMainEpisodes: [
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
  it('renders pending episodes and can dismiss one reminder', async () => {
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
      if (url === '/api/reminders/11/dismiss' && init?.method === 'POST') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findAllByText('测试番剧')).toHaveLength(2);
    expect(screen.getByText('第一集')).toBeInTheDocument();
    expect(screen.getByText('1 / 12')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '忽略' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/reminders/11/dismiss', {
        method: 'POST',
        headers: { 'x-bwp-token': 'client-token' }
      });
    });
  });

  it('refreshes the local API token and retries writes when the server token changed', async () => {
    let authCalls = 0;
    let dismissCalls = 0;
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
      if (url === '/api/reminders/11/dismiss' && init?.method === 'POST') {
        dismissCalls += 1;
        if (dismissCalls === 1) {
          return Response.json({ error: 'Invalid local API token' }, { status: 403 });
        }
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('第一集');
    await userEvent.click(screen.getByRole('button', { name: '忽略' }));

    await waitFor(() => {
      expect(dismissCalls).toBe(2);
    });
    const dismissRequests = fetchMock.mock.calls.filter(([input]) => input.toString() === '/api/reminders/11/dismiss');
    expect(dismissRequests[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'x-bwp-token': 'old-token' }
    });
    expect(dismissRequests[1][1]).toMatchObject({
      method: 'POST',
      headers: { 'x-bwp-token': 'new-token' }
    });
  });

  it('does not show watch-through actions in the pending episode list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('第一集');
    const backlog = screen.getByLabelText('待补新集');
    expect(within(backlog).queryByRole('button', { name: /看到|看过|已看|标记/ })).not.toBeInTheDocument();
  });

  it('shows the total unwatched main episode count for a subject', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (input.toString() === '/api/auth/status') {
          return Response.json({
            authenticated: true,
            username: 'sai',
            nickname: 'Sai',
            lastSyncAt: dashboard.lastSyncAt,
            apiToken: 'client-token'
          });
        }
        if (input.toString() === '/api/dashboard') {
          return Response.json({
            ...dashboard,
            subjects: [{ ...dashboard.subjects[0], unwatchedMainEpisodeCount: 3 }]
          });
        }
        throw new Error(`Unexpected request ${input.toString()}`);
      })
    );

    render(<App />);

    expect(await screen.findByText('3 集未看')).toBeInTheDocument();
  });

  it('does not show watch-through episode buttons in the watching list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
        return Response.json({
          ...dashboard,
          subjects: [
            {
              ...dashboard.subjects[0],
              epStatus: 1,
              unwatchedMainEpisodeCount: 3,
              unwatchedMainEpisodes: [
                dashboard.subjects[0].unwatchedMainEpisodes[0],
                {
                  ...dashboard.subjects[0].unwatchedMainEpisodes[0],
                  id: 12,
                  sort: 2,
                  ep: 2,
                  nameCn: '第二集'
                },
                {
                  ...dashboard.subjects[0].unwatchedMainEpisodes[0],
                  id: 13,
                  sort: 3,
                  ep: 3,
                  nameCn: '第三集'
                }
              ]
            }
          ]
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('3 集未看');
    expect(screen.queryByLabelText(/观看进度/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /看到第|已看/ })).not.toBeInTheDocument();
  });

  it('loads a Bangumi-style calendar tab on demand', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      if (url === '/api/calendar') {
        return Response.json([
          {
            weekday: { en: 'Thu', cn: '星期四', ja: '木耀日', id: 4 },
            items: [
              {
                id: 456,
                name: 'Calendar Anime',
                nameCn: '测试放送',
                url: 'https://bgm.tv/subject/456',
                airDate: '2026-07-09',
                airWeekday: 4,
                image: null,
                ratingScore: 7.2,
                rank: 1234,
                collectionDoing: 321
              }
            ]
          }
        ]);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('第一集');
    await userEvent.click(screen.getByRole('tab', { name: '每日放送' }));

    expect(await screen.findByRole('heading', { name: '每日放送' })).toBeInTheDocument();
    expect(screen.getByText('星期四')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '测试放送' })[0]).toHaveAttribute('href', 'https://bgm.tv/subject/456');
    expect(screen.getByText(/评分 7.2/)).toBeInTheDocument();
    expect(screen.getByText(/321 人在看/)).toBeInTheDocument();
  });

  it('searches anime and can add a result to watching', async () => {
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
      if (url === '/api/search/anime?q=%E6%B5%8B%E8%AF%95') {
        return Response.json({
          results: [
            {
              id: 456,
              name: 'Test Anime',
              nameCn: '测试动画',
              eps: 12,
              image: null,
              url: 'https://bgm.tv/subject/456'
            }
          ]
        });
      }
      if (url === '/api/subjects/456/watching' && init?.method === 'POST') {
        return Response.json({ subjectsSynced: 1, episodesSynced: 12 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.type(await screen.findByLabelText('搜索动画'), '测试');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findAllByText('测试动画')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: '加入在看' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/subjects/456/watching', {
        method: 'POST',
        headers: { 'x-bwp-token': 'client-token' }
      });
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

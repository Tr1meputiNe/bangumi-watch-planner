// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/client/App.js';
import type { AnimeSearchResult, BangumiCollectionType } from '../../src/server/types.js';

afterEach(() => {
  vi.useRealTimers();
});

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
      airTime: '22:30',
      collectionType: 0,
      dismissedAt: null,
      snoozedUntil: null
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
      mainEpisodes: [
        {
          id: 10,
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
          airTime: '22:30',
          collectionType: 2,
          dismissedAt: null,
          snoozedUntil: null
        },
        {
          id: 12,
          subjectId: 1,
          subjectName: 'テスト番組',
          subjectNameCn: '测试番剧',
          subjectUrl: 'https://bgm.tv/subject/1',
          episodeType: 0,
          sort: 2,
          ep: 2,
          name: 'second',
          nameCn: '第二集',
          airdate: '2026-07-09',
          airTime: '23:00',
          collectionType: 0,
          dismissedAt: null,
          snoozedUntil: null
        }
      ],
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
          airTime: '22:30',
          collectionType: 0,
          dismissedAt: null,
          snoozedUntil: null
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
        airTime: '22:30',
        collectionType: 0,
        dismissedAt: null,
        snoozedUntil: null
      }
    }
  ],
  lastSyncAt: '2026-07-08T20:00:00+08:00',
  lastError: null
};

const emptyBacklog = {
  today: '2026-07-30',
  todayTasks: [],
  futureDays: [],
  active: [],
  held: [],
  completed: [],
  estimatedCompletionDate: null
};

function searchResult(
  id: number,
  collectionType: BangumiCollectionType | null,
  watchAction: AnimeSearchResult['watchAction'],
  watchActionLabel: string,
  airDate = '2024-01-01'
): AnimeSearchResult {
  const wishlistLabels: Record<BangumiCollectionType, string> = {
    1: '已在想看',
    2: '已看过',
    3: '已在看',
    4: '已搁置',
    5: '已抛弃'
  };
  return {
    id,
    name: `Test Anime ${id}`,
    nameCn: `测试动画 ${id}`,
    airDate,
    eps: 12,
    image: null,
    url: `https://bgm.tv/subject/${id}`,
    collectionType,
    watchAction,
    watchActionLabel,
    wishlistAction: collectionType === null ? 'add' : null,
    wishlistActionLabel: collectionType === null ? '加入想看' : wishlistLabels[collectionType]
  };
}

describe('App', () => {
  it('resumes an OAuth background sync after startup without hiding cached data', async () => {
    let dashboardRequests = 0;
    let statusRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') {
        dashboardRequests += 1;
        return Response.json(dashboard);
      }
      if (url === '/api/sync/status') {
        statusRequests += 1;
        return Response.json(statusRequests === 1
          ? {
              state: 'running',
              startedAt: '2026-07-30T12:00:00.000Z',
              completedAt: null,
              error: null,
              processedSubjects: 1,
              totalSubjects: 4,
              result: null
            }
          : {
              state: 'idle',
              startedAt: '2026-07-30T12:00:00.000Z',
              completedAt: '2026-07-30T12:00:05.000Z',
              error: null,
              processedSubjects: 4,
              totalSubjects: 4,
              result: { subjectsSynced: 4, episodesSynced: 48 }
            });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findAllByText('测试番剧')).not.toHaveLength(0);
    expect(await screen.findByRole('button', { name: '同步中 1/4' })).toBeDisabled();
    expect(dashboardRequests).toBe(1);

    expect(await screen.findByRole('status', {}, { timeout: 2_000 })).toHaveTextContent('同步完成：4 部番剧，48 集分集');
    expect(dashboardRequests).toBe(2);
  });

  it('keeps cached data and offers manual retry when the resumed sync failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') return Response.json(dashboard);
      if (url === '/api/sync/status') {
        return Response.json({
          state: 'error',
          startedAt: '2026-07-30T12:00:00.000Z',
          completedAt: '2026-07-30T12:00:05.000Z',
          error: 'Bangumi 暂时不可用',
          processedSubjects: 1,
          totalSubjects: 4,
          result: null
        });
      }
      throw new Error(`Unexpected request ${url}`);
    }));

    render(<App />);

    expect(await screen.findAllByText('测试番剧')).not.toHaveLength(0);
    expect(await screen.findByText('Bangumi 暂时不可用 可点击“立即同步”重试。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled();
  });

  it('keeps cached controls usable while background sync runs, then refreshes', async () => {
    let dashboardRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') {
        dashboardRequests += 1;
        return Response.json(dashboard);
      }
      if (url === '/api/sync' && init?.method === 'POST') {
        return Response.json({
          state: 'running',
          startedAt: '2026-07-30T12:00:00.000Z',
          completedAt: null,
          error: null,
          processedSubjects: 0,
          totalSubjects: 4,
          result: null
        }, { status: 202 });
      }
      if (url === '/api/sync/status') {
        return Response.json({
          state: 'idle',
          startedAt: '2026-07-30T12:00:00.000Z',
          completedAt: '2026-07-30T12:00:05.000Z',
          error: null,
          processedSubjects: 4,
          totalSubjects: 4,
          result: { subjectsSynced: 4, episodesSynced: 48 }
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: '立即同步' }));

    const pendingButton = await screen.findByRole('button', { name: '同步中 0/4' });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('tab', { name: /补番计划/ })).toBeEnabled();
    expect(screen.queryByLabelText('搜索动画')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => input.toString() === '/api/sync')).toHaveLength(1);

    expect(await screen.findByRole('status', {}, { timeout: 2_000 })).toHaveTextContent('同步完成：4 部番剧，48 集分集');
    expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled();
    expect(dashboardRequests).toBe(2);
  });

  it('shows a readable local-service error instead of Failed to fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') return Response.json(dashboard);
      if (url === '/api/sync' && init?.method === 'POST') throw new TypeError('Failed to fetch');
      throw new Error(`Unexpected request ${url}`);
    }));

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: '立即同步' }));

    expect(await screen.findByText('无法连接本机服务，请确认应用仍在运行后重试。')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled();
  });

  it('shows an HTTP fallback when an error response has no usable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') return Response.json(dashboard);
      if (url === '/api/sync' && init?.method === 'POST') return new Response(null, { status: 502 });
      throw new Error(`Unexpected request ${url}`);
    }));

    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: '立即同步' }));

    expect(await screen.findByText('请求失败（HTTP 502）')).toBeInTheDocument();
  });

  it('shows four tabs in the required order and loads backlog only when opened', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: null });
      }
      if (url === '/api/dashboard') {
        return Response.json(dashboard);
      }
      if (url === '/api/backlog') {
        return Response.json({
          today: '2026-07-19',
          todayTasks: [],
          futureDays: [],
          active: [{ ...dashboard.subjects[0], id: 99, nameCn: '旧番标题', plannerMode: 'backlog' }],
          held: [],
          completed: [],
          estimatedCompletionDate: null
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
      '追番提醒',
      '补番计划',
      '想看',
      '每日放送'
    ]);
    expect(fetchMock.mock.calls.some(([input]) => input.toString() === '/api/backlog')).toBe(false);
    expect(document.querySelector('.hallmark-workbench')).toBeInTheDocument();
    expect(document.querySelectorAll('.page-tabs .tab-mark')).toHaveLength(4);
    expect(document.querySelector('.app-footer')).toBeInTheDocument();
    expect(screen.getByLabelText('近期在看').querySelector('img')).toHaveAttribute('src', 'cover.jpg');
    expect(screen.getByLabelText('待补新集').querySelector('.title-cover-reel')).not.toBeInTheDocument();
    expect(document.querySelector('.page-ambient-covers')).not.toBeInTheDocument();
    expect(document.querySelector('.page-ambient-ornament')).toBeInTheDocument();
    expect(screen.getAllByText('测试番剧').length).toBeGreaterThan(0);
    expect(screen.queryByText('旧番标题')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '补番计划' }));

    expect(await screen.findByText('旧番标题')).toBeInTheDocument();
    expect(screen.getByLabelText('搜索动画')).toBeEnabled();
    expect(screen.queryByText('测试番剧')).not.toBeInTheDocument();
  });

  it('renders pending episodes and can dismiss one reminder', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt
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
    expect(screen.getByLabelText('待补新集').querySelector('img')).toHaveAttribute('src', 'cover.jpg');
    expect(screen.getByText('第一集')).toBeInTheDocument();
    expect(screen.getByText('22:30')).toBeInTheDocument();
    expect(screen.getByText('1 / 12')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '忽略' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/reminders/11/dismiss', {
        method: 'POST'
      });
    });
  });

  it('refreshes the local API cookie and retries writes when the server token changed', async () => {
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
          lastSyncAt: dashboard.lastSyncAt
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
    expect(authCalls).toBe(3);
    const dismissRequests = fetchMock.mock.calls.filter(([input]) => input.toString() === '/api/reminders/11/dismiss');
    expect(dismissRequests[0][1]).toMatchObject({
      method: 'POST'
    });
    expect(dismissRequests[1][1]).toMatchObject({
      method: 'POST'
    });
  });

  it('can mark a pending episode as watched', async () => {
    let pending = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt
        });
      }
      if (url === '/api/dashboard') {
        return Response.json({ ...dashboard, pendingEpisodes: pending ? dashboard.pendingEpisodes : [] });
      }
      if (url === '/api/episodes/11/watched' && init?.method === 'POST') {
        pending = false;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('第一集');
    const backlog = screen.getByLabelText('待补新集');
    await userEvent.click(within(backlog).getByRole('button', { name: '已看' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/episodes/11/watched', {
        method: 'POST'
      });
    });
    await waitFor(() => {
      expect(within(backlog).queryByText('第一集')).not.toBeInTheDocument();
    });
  });

  it('can postpone a pending seasonal episode until tomorrow', async () => {
    let pending = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt
        });
      }
      if (url === '/api/dashboard') {
        return Response.json({ ...dashboard, pendingEpisodes: pending ? dashboard.pendingEpisodes : [] });
      }
      if (url === '/api/reminders/11/tomorrow' && init?.method === 'POST') {
        pending = false;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('第一集');
    const backlog = screen.getByLabelText('待补新集');
    await userEvent.click(within(backlog).getByRole('button', { name: '明天再看' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/reminders/11/tomorrow', {
        method: 'POST'
      });
    });
    await waitFor(() => {
      expect(within(backlog).queryByText('第一集')).not.toBeInTheDocument();
    });
  });

  it('shows a postponed episode again when a later dashboard refresh returns it', async () => {
    let snoozed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') {
        return Response.json({ ...dashboard, pendingEpisodes: snoozed ? [] : dashboard.pendingEpisodes });
      }
      if (url === '/api/reminders/11/tomorrow' && init?.method === 'POST') {
        snoozed = true;
        return new Response(null, { status: 204 });
      }
      if (url === '/api/sync' && init?.method === 'POST') {
        snoozed = false;
        return Response.json({
          state: 'running',
          startedAt: '2026-07-30T12:00:00.000Z',
          completedAt: null,
          error: null,
          processedSubjects: 0,
          totalSubjects: 1,
          result: null
        }, { status: 202 });
      }
      if (url === '/api/sync/status') {
        return Response.json({
          state: 'idle',
          startedAt: '2026-07-30T12:00:00.000Z',
          completedAt: '2026-07-30T12:00:01.000Z',
          error: null,
          processedSubjects: 1,
          totalSubjects: 1,
          result: { subjectsSynced: 1, episodesSynced: 1 }
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    const backlog = await screen.findByLabelText('待补新集');
    await userEvent.click(within(backlog).getByRole('button', { name: '明天再看' }));
    await waitFor(() => expect(within(backlog).queryByText('第一集')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '立即同步' }));

    expect(await within(backlog).findByText('第一集', {}, { timeout: 2_000 })).toBeInTheDocument();
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
            lastSyncAt: dashboard.lastSyncAt
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

  it('shows the next episode airdate in the watching list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (input.toString() === '/api/auth/status') {
          return Response.json({
            authenticated: true,
            username: 'sai',
            nickname: 'Sai',
            lastSyncAt: dashboard.lastSyncAt
          });
        }
        if (input.toString() === '/api/dashboard') {
          return Response.json(dashboard);
        }
        throw new Error(`Unexpected request ${input.toString()}`);
      })
    );

    render(<App />);

    expect(await screen.findByText('下一集：第一集 · 播出时间：2026-07-08 22:30')).toBeInTheDocument();
  });

  it('can mark a watched episode back to unwatched from the watching list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt
        });
      }
      if (url === '/api/dashboard') {
        return Response.json({
          ...dashboard,
          subjects: [
            {
              ...dashboard.subjects[0],
              epStatus: 1,
              unwatchedMainEpisodeCount: 1,
              unwatchedMainEpisodes: [
                dashboard.subjects[0].mainEpisodes[1]
              ]
            }
          ]
        });
      }
      if (url === '/api/episodes/10/unwatched') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('1 集未看');
    const watchedButton = screen.getByRole('button', { name: '测试番剧 第 1 集 取消看过' });
    expect(watchedButton).toHaveTextContent('01');

    await userEvent.click(watchedButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/episodes/10/unwatched', {
        method: 'POST'
      });
    });
  });

  it('can mark progress from unwatched episode buttons in the watching list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt
        });
      }
      if (url === '/api/dashboard') {
        return Response.json(dashboard);
      }
      if (url === '/api/subjects/1/watched-through' && init?.method === 'POST') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('1 集未看');
    const unwatchedButton = screen.getByRole('button', { name: '测试番剧 第 2 集 标为看过' });
    expect(unwatchedButton).toHaveTextContent('02');

    await userEvent.click(unwatchedButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/subjects/1/watched-through', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ episodeId: 12 })
      });
    });
  });

  it('loads a Bangumi-style calendar tab on demand and starts from today', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-10T04:00:00.000Z'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt
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
                airTime: '22:30',
                airWeekday: 4,
                image: null,
                ratingScore: 7.2,
                rank: 1234,
                collectionDoing: 321
              }
            ]
          },
          {
            weekday: { en: 'Fri', cn: '星期五', ja: '金耀日', id: 5 },
            items: [
              {
                id: 457,
                name: 'Friday Anime',
                nameCn: '周五放送',
                url: 'https://bgm.tv/subject/457',
                airDate: '2026-07-10',
                airTime: '23:00',
                airWeekday: 5,
                image: null,
                ratingScore: null,
                rank: null,
                collectionDoing: null
              },
              {
                id: 458,
                name: 'Friday Early Anime',
                nameCn: '周五早播',
                url: 'https://bgm.tv/subject/458',
                airDate: '2026-07-10',
                airTime: '20:00',
                airWeekday: 5,
                image: null,
                ratingScore: null,
                rank: null,
                collectionDoing: null
              }
            ]
          },
          {
            weekday: { en: 'Sat', cn: '星期六', ja: '土耀日', id: 6 },
            items: []
          },
          {
            weekday: { en: 'Sun', cn: '星期日', ja: '日耀日', id: 7 },
            items: []
          }
        ]);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await screen.findByText('第一集');
    await user.click(screen.getByRole('tab', { name: '每日放送' }));

    expect(await screen.findByRole('heading', { name: '每日放送' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      '星期五',
      '星期六',
      '星期日',
      '星期四'
    ]);
    const friday = screen.getByLabelText('星期五 2 部');
    expect(document.querySelector('.calendar-overview-covers')).not.toBeInTheDocument();
    expect([...friday.querySelectorAll('.calendar-subject div > a')].map((link) => link.textContent)).toEqual(['周五早播', '周五放送']);
    expect(friday).toHaveClass('is-today');
    expect(screen.getByLabelText('2026-07-10 20:00')).toHaveClass('calendar-air');
    expect(screen.getAllByRole('link', { name: '测试放送' })[0]).toHaveAttribute('href', 'https://bgm.tv/subject/456');
    expect(screen.getAllByRole('link', { name: '周五放送' })[0]).toHaveAttribute('href', 'https://bgm.tv/subject/457');
    expect(screen.getByLabelText('2026-07-09 22:30')).toBeInTheDocument();
    expect(screen.getByText(/评分 7.2/)).toBeInTheDocument();
    expect(screen.getByText(/321 人在看/)).toBeInTheDocument();
  });

  it('optimistically marks a search result as backlog while the request runs in the background', async () => {
    let resolveWatching!: (response: Response) => void;
    const watchingResponse = new Promise<Response>((resolve) => {
      resolveWatching = resolve;
    });
    let dashboardRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt
        });
      }
      if (url === '/api/dashboard') {
        dashboardRequests += 1;
        return Response.json(dashboard);
      }
      if (url === '/api/backlog') return Response.json(emptyBacklog);
      if (url === '/api/search/anime?q=%E6%B5%8B%E8%AF%95') {
        return Response.json({
          results: [
            {
              id: 456,
              name: 'Test Anime',
              nameCn: '测试动画',
              airDate: '2024-01-01',
              eps: 12,
              image: null,
              url: 'https://bgm.tv/subject/456',
              collectionType: null,
              watchAction: 'add',
              watchActionLabel: '加入补番',
              wishlistAction: 'add',
              wishlistActionLabel: '加入想看'
            }
          ]
        });
      }
      if (url === '/api/subjects/456/watching' && init?.method === 'POST') {
        return watchingResponse;
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.click(await screen.findByRole('tab', { name: '补番计划' }));
    await userEvent.type(await screen.findByLabelText('搜索动画'), '测试');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findAllByText('测试动画')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: '加入补番' }));

    expect(screen.getAllByRole('button', { name: '已在看' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '已在看' }).every((button) => button.hasAttribute('disabled'))).toBe(true);
    expect(screen.queryByRole('button', { name: '处理中' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/subjects/456/watching', {
        method: 'POST'
      });
    });
    expect(dashboardRequests).toBe(1);

    resolveWatching(Response.json({ subjectsSynced: 1, episodesSynced: 12 }));
    await waitFor(() => expect(dashboardRequests).toBe(2));
    expect(screen.getAllByText('测试动画')).toHaveLength(2);
  });

  it('optimistically adds a global search result to the wishlist', async () => {
    let resolveWishlist!: (response: Response) => void;
    const wishlistResponse = new Promise<Response>((resolve) => {
      resolveWishlist = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') return Response.json(dashboard);
      if (url === '/api/backlog') return Response.json(emptyBacklog);
      if (url === '/api/search/anime?q=%E6%B5%8B%E8%AF%95') {
        return Response.json({ results: [searchResult(451, null, 'add', '加入补番')] });
      }
      if (url === '/api/subjects/451/wishlist' && init?.method === 'POST') return wishlistResponse;
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.click(await screen.findByRole('tab', { name: '补番计划' }));
    await userEvent.type(await screen.findByLabelText('搜索动画'), '测试');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    await userEvent.click(await screen.findByRole('button', { name: '加入想看' }));

    expect(screen.getByRole('button', { name: '已在想看' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '加入补番' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/subjects/451/wishlist', { method: 'POST' });

    resolveWishlist(Response.json({ subjectsSynced: 1, episodesSynced: 0 }));
    await waitFor(() => expect(screen.getByRole('button', { name: '加入补番' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '已在想看' })).toBeDisabled();
  });

  it('renders every saved search state and calls only its legal transition', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({
          authenticated: true,
          username: 'sai',
          nickname: 'Sai',
          lastSyncAt: dashboard.lastSyncAt
        });
      }
      if (url === '/api/dashboard') return Response.json(dashboard);
      if (url === '/api/backlog') return Response.json(emptyBacklog);
      if (url === '/api/search/anime?q=%E6%B5%8B%E8%AF%95') {
        return Response.json({
          results: [
            searchResult(451, 1, null, '尚未播出'),
            searchResult(452, 1, 'start', '开始追番'),
            searchResult(453, 1, 'start', '加入补番'),
            searchResult(454, 3, null, '已在看'),
            searchResult(455, 4, 'resume', '恢复补番'),
            searchResult(456, 2, null, '已看过')
          ]
        });
      }
      if (url === '/api/subjects/452/start' && init?.method === 'POST') {
        return Response.json({ subjectsSynced: 1, episodesSynced: 12 });
      }
      if (url === '/api/subjects/453/start' && init?.method === 'POST') {
        return Response.json({ subjectsSynced: 1, episodesSynced: 12 });
      }
      if (url === '/api/backlog/455/resume' && init?.method === 'POST') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await userEvent.click(await screen.findByRole('tab', { name: '补番计划' }));
    await userEvent.type(await screen.findByLabelText('搜索动画'), '测试');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));

    for (const label of ['尚未播出', '已在看', '已看过']) {
      const buttons = await screen.findAllByRole('button', { name: label });
      expect(buttons.every((button) => button.hasAttribute('disabled'))).toBe(true);
    }

    await userEvent.click(screen.getByRole('button', { name: '开始追番' }));
    await userEvent.click(screen.getByRole('button', { name: '加入补番' }));
    await userEvent.click(screen.getByRole('button', { name: '恢复补番' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/subjects/452/start', { method: 'POST' });
      expect(fetchMock).toHaveBeenCalledWith('/api/subjects/453/start', { method: 'POST' });
      expect(fetchMock).toHaveBeenCalledWith('/api/backlog/455/resume', { method: 'POST' });
    });
    expect(screen.getAllByRole('button', { name: '已在看' })).toHaveLength(8);
  });

  it('keeps the search state when a collection transition fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') return Response.json(dashboard);
      if (url === '/api/backlog') return Response.json(emptyBacklog);
      if (url === '/api/search/anime?q=%E6%B5%8B%E8%AF%95') {
        return Response.json({ results: [searchResult(455, 4, 'resume', '恢复补番')] });
      }
      if (url === '/api/backlog/455/resume' && init?.method === 'POST') {
        return Response.json({ error: 'Bangumi write failed' }, { status: 502 });
      }
      throw new Error(`Unexpected request ${url}`);
    }));

    render(<App />);

    await userEvent.click(await screen.findByRole('tab', { name: '补番计划' }));
    await userEvent.type(await screen.findByLabelText('搜索动画'), '测试');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    await userEvent.click(await screen.findByRole('button', { name: '恢复补番' }));

    expect(await screen.findByText('Bangumi write failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复补番' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '已在看' })).not.toBeInTheDocument();
  });

  it('keeps the successful collection state when the dashboard refresh fails', async () => {
    let dashboardRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/auth/status') {
        return Response.json({ authenticated: true, username: 'sai', nickname: 'Sai', lastSyncAt: dashboard.lastSyncAt });
      }
      if (url === '/api/dashboard') {
        dashboardRequests += 1;
        return dashboardRequests === 1
          ? Response.json(dashboard)
          : Response.json({ error: 'Dashboard refresh failed' }, { status: 502 });
      }
      if (url === '/api/backlog') return Response.json(emptyBacklog);
      if (url === '/api/search/anime?q=%E6%B5%8B%E8%AF%95') {
        return Response.json({ results: [searchResult(451, null, 'add', '加入补番')] });
      }
      if (url === '/api/subjects/451/watching' && init?.method === 'POST') {
        return Response.json({ subjectsSynced: 1, episodesSynced: 12 });
      }
      throw new Error(`Unexpected request ${url}`);
    }));

    render(<App />);

    await userEvent.click(await screen.findByRole('tab', { name: '补番计划' }));
    await userEvent.type(await screen.findByLabelText('搜索动画'), '测试');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    await userEvent.click(await screen.findByRole('button', { name: '加入补番' }));

    expect(await screen.findByText('Dashboard refresh failed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '已在看' }).every((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('shows Bangumi OAuth login without a local password gate', async () => {
    let dashboardRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (input.toString() === '/api/auth/status') {
          return Response.json({
            authenticated: false,
            username: null,
            nickname: null,
            lastSyncAt: null,
            configured: true
          });
        }
        if (input.toString() === '/api/dashboard') {
          dashboardRequests += 1;
          return Response.json({ pendingEpisodes: [], subjects: [], lastSyncAt: null, lastError: null });
        }
        throw new Error(`Unexpected request ${input.toString()}`);
      })
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: '登录 Bangumi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用 Bangumi 登录' })).toHaveAttribute('href', '/auth/login');
    expect(screen.queryByLabelText('访问密码')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '追番提醒' })).not.toBeInTheDocument();
    expect(dashboardRequests).toBe(0);
  });

  it('lets the user configure OAuth before opening Bangumi login', async () => {
    let oauthConfigured = false;
    let dashboardRequests = 0;
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
          oauthClientId: oauthConfigured ? 'client-id' : null
        });
      }
      if (url === '/api/dashboard') {
        dashboardRequests += 1;
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

    expect(await screen.findByRole('heading', { name: '配置 Bangumi 登录' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '打开 Bangumi 开发者平台' })).toHaveAttribute('href', 'https://bgm.tv/dev');
    expect(screen.getByText('http://127.0.0.1:3777/auth/callback')).toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText('Bangumi App ID'), 'client-id');
    await userEvent.type(screen.getByLabelText('Bangumi App Secret'), 'client-secret');
    await userEvent.click(screen.getByRole('button', { name: '保存 OAuth 配置' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/settings/oauth', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ clientId: 'client-id', clientSecret: 'client-secret' })
      });
    });
    expect(await screen.findByRole('link', { name: '使用 Bangumi 登录' })).toHaveAttribute('href', '/auth/login');
    expect(dashboardRequests).toBe(0);
  });
});

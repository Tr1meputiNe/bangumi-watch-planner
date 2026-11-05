// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WatchingView from '../../src/client/views/WatchingView.js';
import type { BacklogData, DashboardData, DashboardSubject, EpisodeRow } from '../../src/server/types.js';

const episode = (id = 11): EpisodeRow => ({
  id, subjectId: 1, subjectName: 'Original title', subjectNameCn: '测试番剧',
  subjectUrl: 'https://bgm.tv/subject/1', episodeType: 0, sort: id - 10, ep: id - 10,
  name: 'Episode', nameCn: `第 ${id - 10} 话`, airdate: '2026-07-08', airTime: '22:30',
  collectionType: 0, dismissedAt: null, snoozedUntil: null
});
const subject: DashboardSubject = {
  id: 1, name: 'Original title', nameCn: '测试番剧', eps: 12, epStatus: 0,
  image: null, url: 'https://bgm.tv/subject/1', collectionType: 3, plannerMode: 'seasonal',
  seasonKey: '2026-07', seasonKind: 'new', airYear: 2026, totalEpisodesKnown: true, completedAt: null,
  nextEpisode: episode(), mainEpisodes: [episode(), episode(12)], progressEpisodes: [episode(), episode(12)],
  unwatchedMainEpisodeCount: 2, unwatchedProgressEpisodeCount: 2, unwatchedMainEpisodes: [episode(), episode(12)]
};
const dashboard: DashboardData = { subjects: [subject], pendingEpisodes: [episode(), episode(12)], lastSyncAt: null, lastError: null };
const backlog: BacklogData = {
  today: '2026-07-08', todayTasks: [], futureDays: [], active: [subject], held: [], completed: [], estimatedCompletionDate: null,
  recent: [{ ...subject, id: 2, nameCn: '最近看的旧番', plannerMode: 'backlog' }]
};
const props = { dashboard, disabled: false, onChanged: vi.fn(async () => {}), onError: vi.fn() };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('WatchingView', () => {
  it('shows recent viewing instead of planned backlog tasks and opens the full library', async () => {
    const onOpenBacklog = vi.fn();
    render(<WatchingView {...props} mode="today" backlog={backlog} onOpenBacklog={onOpenBacklog} />);
    expect(screen.getByRole('heading', { name: '今天' })).toBeInTheDocument();
    expect(screen.getByLabelText('接着看')).toHaveTextContent('最近看的旧番');
    expect(screen.queryByText('今日补番')).not.toBeInTheDocument();
    expect(screen.queryByText('换一部')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '全部补番' }));
    expect(onOpenBacklog).toHaveBeenCalledOnce();
  });

  it('shows a retryable viewing-history error instead of an endless loading state', async () => {
    let finish!: () => void;
    const onRetryBacklog = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<WatchingView {...props} mode="today" backlog={null} backlogError="观看记录暂时不可用" onRetryBacklog={onRetryBacklog} />);
    const section = screen.getByLabelText('接着看');
    expect(within(section).getByRole('alert')).toHaveTextContent('观看记录暂时不可用');
    expect(within(section).queryByText('正在加载观看记录。')).not.toBeInTheDocument();
    const retry = within(section).getByRole('button', { name: '重试观看记录' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(onRetryBacklog).toHaveBeenCalledOnce();
    expect(retry).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(retry).toBeEnabled());
  });

  it('does not invent recent viewing from the active library', () => {
    render(<WatchingView {...props} mode="today" backlog={{ ...backlog, recent: [] }} />);
    expect(screen.getByLabelText('接着看')).not.toHaveTextContent('测试番剧');
    expect(screen.getByLabelText('接着看')).toHaveTextContent('暂无最近观看');
  });

  it('locks all episode actions while a mutation is pending, including repeated clicks', async () => {
    let finish!: () => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = () => resolve(new Response(null, { status: 204 })); }));
    vi.stubGlobal('fetch', fetchMock);
    render(<WatchingView {...props} mode="today" backlog={backlog} />);
    const section = screen.getByLabelText('今日追番');
    const buttons = within(section).getAllByRole('button', { name: '已看' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(buttons[1]).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(buttons[1]).toBeEnabled());
  });

  it('keeps an explicit retry when loading the episode grid fails', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      return requests === 1 ? Response.json({ error: '暂时离线' }, { status: 503 }) : Response.json({ episodes: [episode()] });
    }));
    render(<WatchingView {...props} mode="watching" />);
    await userEvent.click(screen.getByRole('button', { name: '查看测试番剧集数' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时离线');
    await userEvent.click(screen.getByRole('button', { name: '重试加载集数' }));
    expect(await screen.findByRole('button', { name: '测试番剧 第 1 集 标为看过' })).toBeInTheDocument();
  });

  it('ignores older episode responses after a newer refresh succeeds', async () => {
    let resolveFirst!: (response: Response) => void;
    let count = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      count += 1;
      if (count === 1) return new Promise<Response>((resolve) => { resolveFirst = resolve; });
      return Response.json({ episodes: [{ ...episode(), collectionType: 2 }] });
    }));
    const { rerender } = render(<WatchingView {...props} mode="watching" />);
    await userEvent.click(screen.getByRole('button', { name: '查看测试番剧集数' }));
    rerender(<WatchingView {...props} mode="watching" refreshVersion={1} />);
    expect(await screen.findByRole('button', { name: '测试番剧 第 1 集 取消看过' })).toBeInTheDocument();
    await act(async () => resolveFirst(Response.json({ episodes: [episode()] })));
    expect(screen.getByRole('button', { name: '测试番剧 第 1 集 取消看过' })).toBeInTheDocument();
  });

  it('updates the date when a page remains open past midnight in Shanghai', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T15:59:59Z'));
    render(<WatchingView {...props} mode="today" backlog={backlog} />);
    expect(screen.getByText(/7月8日/)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText(/7月9日/)).toBeInTheDocument();
  });

  it('renders an empty state for an empty watching collection', () => {
    render(<WatchingView {...props} mode="watching" dashboard={{ ...dashboard, subjects: [], pendingEpisodes: [] }} />);
    expect(screen.getByText('暂无正在追的新番。')).toBeInTheDocument();
  });
});

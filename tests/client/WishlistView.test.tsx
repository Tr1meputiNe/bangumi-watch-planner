// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WishlistView from '../../src/client/views/WishlistView.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('WishlistView', () => {
  it('filters by debounced name and every year option without writing Bangumi state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.fn(async () => Response.json(wishlistData()));
    vi.stubGlobal('fetch', fetchMock);
    render(<WishlistView disabled={false} refreshVersion={0} onSyncStarted={vi.fn()} onError={vi.fn()} />);

    expect(await screen.findByRole('option', { name: '2024' })).toBeInTheDocument();
    expect(screen.getByText('3 部')).toHaveClass('wishlist-count');
    expect(document.querySelectorAll('.wishlist-item')).toHaveLength(3);
    expect(document.querySelector('.wishlist-hero-covers')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '全部年份' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '年份未知' })).toBeInTheDocument();
    expect(screen.getByText('我的片单')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '想看' })).toBeInTheDocument();
    expect(screen.queryByText('先收进片库，到合适的季度再开始。')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('搜索想看'), '测试');
    await user.selectOptions(screen.getByLabelText('年份'), '2024');
    await act(async () => { vi.advanceTimersByTime(250); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/wishlist?q=%E6%B5%8B%E8%AF%95&year=2024'));

    await user.selectOptions(screen.getByLabelText('年份'), 'all');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/wishlist?q=%E6%B5%8B%E8%AF%95&year=all'));
    await user.selectOptions(screen.getByLabelText('年份'), 'unknown');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/wishlist?q=%E6%B5%8B%E8%AF%95&year=unknown'));

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('labels current, older, and upcoming titles and starts only the clicked title', async () => {
    let resolveStart!: (response: Response) => void;
    const startResponse = new Promise<Response>((resolve) => {
      resolveStart = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === '/api/wishlist?q=&year=all') return Response.json(wishlistData());
      if (input.toString() === '/api/subjects/201/start' && init?.method === 'POST') {
        return startResponse;
      }
      throw new Error(`Unexpected request ${input.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSyncStarted = vi.fn();
    render(<WishlistView disabled={false} refreshVersion={0} onSyncStarted={onSyncStarted} onError={vi.fn()} />);

    expect(await screen.findByText('本季度')).toBeInTheDocument();
    expect(screen.getAllByText('旧番')).toHaveLength(1);
    expect(screen.getByText('未播出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始追番' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入补番' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '尚未播出' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '开始追番' }));

    expect(screen.queryByText('本季度想看')).not.toBeInTheDocument();
    expect(screen.getByText('2 部')).toHaveClass('wishlist-count');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/subjects/201/start', { method: 'POST' }));
    expect(onSyncStarted).not.toHaveBeenCalled();

    resolveStart(Response.json(runningSyncStatus()));
    await waitFor(() => expect(onSyncStarted).toHaveBeenCalledWith(expect.objectContaining({ state: 'running' })));
  });

  it('restores an optimistically removed title when the background request fails', async () => {
    let rejectStart!: (response: Response) => void;
    const startResponse = new Promise<Response>((resolve) => {
      rejectStart = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === '/api/wishlist?q=&year=all') return Response.json(wishlistData());
      if (input.toString() === '/api/subjects/202/start' && init?.method === 'POST') return startResponse;
      throw new Error(`Unexpected request ${input.toString()}`);
    }));
    const onError = vi.fn();
    const onSyncStarted = vi.fn();
    render(<WishlistView disabled={false} refreshVersion={0} onSyncStarted={onSyncStarted} onError={onError} />);

    await screen.findByText('旧番想看');
    await userEvent.click(screen.getByRole('button', { name: '加入补番' }));
    expect(screen.queryByText('旧番想看')).not.toBeInTheDocument();

    rejectStart(Response.json({ error: 'Bangumi write failed' }, { status: 502 }));

    expect(await screen.findByText('旧番想看')).toBeInTheDocument();
    expect(screen.getByText('3 部')).toHaveClass('wishlist-count');
    expect(onSyncStarted).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('Bangumi write failed');
  });

  it('reloads the current filter after a queued collection action finishes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === '/api/wishlist?q=&year=all') return Response.json(wishlistData());
      if (input.toString() === '/api/subjects/202/start' && init?.method === 'POST') {
        return Response.json(runningSyncStatus(), { status: 202 });
      }
      throw new Error(`Unexpected request ${input.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSyncStarted = vi.fn();
    const { rerender } = render(
      <WishlistView disabled={false} refreshVersion={0} onSyncStarted={onSyncStarted} onError={vi.fn()} />
    );

    await screen.findByText('旧番想看');
    await userEvent.click(screen.getByRole('button', { name: '加入补番' }));
    expect(screen.queryByText('旧番想看')).not.toBeInTheDocument();
    await waitFor(() => expect(onSyncStarted).toHaveBeenCalled());

    rerender(<WishlistView disabled={false} refreshVersion={1} onSyncStarted={onSyncStarted} onError={vi.fn()} />);

    expect(await screen.findByText('旧番想看')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => input.toString() === '/api/wishlist?q=&year=all')).toHaveLength(2);
  });
});

function wishlistData() {
  return {
    items: [
      {
        id: 201,
        name: 'Current Anime',
        nameCn: '本季度想看',
        eps: 12,
        epStatus: 0,
        image: null,
        url: 'https://bgm.tv/subject/201',
        collectionType: 1,
        plannerMode: null,
        seasonKey: '2026Q3',
        seasonKind: 'new',
        airYear: 2026,
        totalEpisodesKnown: true,
        completedAt: null,
        isCurrentSeason: true
      },
      {
        id: 202,
        name: 'Old Anime',
        nameCn: '旧番想看',
        eps: 0,
        epStatus: 0,
        image: null,
        url: 'https://bgm.tv/subject/202',
        collectionType: 1,
        plannerMode: null,
        seasonKey: null,
        seasonKind: null,
        airYear: 2024,
        totalEpisodesKnown: false,
        completedAt: null,
        isCurrentSeason: false
      },
      {
        id: 203,
        name: 'Upcoming Anime',
        nameCn: '未来想看',
        eps: 12,
        epStatus: 0,
        image: null,
        url: 'https://bgm.tv/subject/203',
        collectionType: 1,
        plannerMode: null,
        seasonKey: null,
        seasonKind: null,
        airDate: '2027-01-01',
        airYear: 2027,
        totalEpisodesKnown: true,
        completedAt: null,
        isCurrentSeason: false,
        isUpcoming: true
      }
    ],
    years: [2027, 2026, 2024]
  };
}

function runningSyncStatus() {
  return {
    state: 'running',
    startedAt: '2026-07-30T12:00:00.000Z',
    completedAt: null,
    error: null,
    processedSubjects: 0,
    totalSubjects: 0,
    result: null
  };
}

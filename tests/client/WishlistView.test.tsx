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
    render(<WishlistView disabled={false} onChanged={vi.fn()} onError={vi.fn()} />);

    expect(await screen.findByRole('option', { name: '2024' })).toBeInTheDocument();
    expect(screen.getByText('2 部')).toHaveClass('wishlist-count');
    expect(document.querySelectorAll('.wishlist-item')).toHaveLength(2);
    expect(screen.getByRole('option', { name: '全部年份' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '年份未知' })).toBeInTheDocument();

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

  it('labels current and older titles and starts only the clicked title', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === '/api/wishlist?q=&year=all') return Response.json(wishlistData());
      if (input.toString() === '/api/subjects/201/start' && init?.method === 'POST') {
        return Response.json({ subjectsSynced: 1, episodesSynced: 12 });
      }
      throw new Error(`Unexpected request ${input.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn(async () => undefined);
    render(<WishlistView disabled={false} onChanged={onChanged} onError={vi.fn()} />);

    expect(await screen.findByText('本季度')).toBeInTheDocument();
    expect(screen.getByText('旧番')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始追番' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入补番' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '开始追番' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/subjects/201/start', { method: 'POST' }));
    expect(onChanged).toHaveBeenCalledOnce();
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
      }
    ],
    years: [2026, 2024]
  };
}

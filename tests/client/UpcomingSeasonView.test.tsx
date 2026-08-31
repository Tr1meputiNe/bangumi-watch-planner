// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import UpcomingSeasonView from '../../src/client/views/UpcomingSeasonView.js';

describe('UpcomingSeasonView', () => {
  it('shows only Bangumi-confirmed Yuc items and schedules the selected title optimistically', async () => {
    let resolveAction!: (response: Response) => void;
    const actionResponse = new Promise<Response>((resolve) => { resolveAction = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === '/api/upcoming-season') return Response.json(upcomingData());
      if (input.toString() === '/api/upcoming-season/501/wishlist' && init?.method === 'POST') return actionResponse;
      throw new Error(`Unexpected request ${input.toString()}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSyncStarted = vi.fn();

    render(<UpcomingSeasonView disabled={false} refreshVersion={0} onSyncStarted={onSyncStarted} onError={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: '2026 秋季新番' })).toBeInTheDocument();
    expect(screen.getByText('Yuc 新番站 · Bangumi 已确认')).toBeInTheDocument();
    expect(screen.getByText('2 部')).toHaveClass('wishlist-count');
    expect(screen.getByRole('heading', { name: '星期一' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '星期二' })).toBeInTheDocument();
    expect(screen.getByText('首播 10月5日 · 22:00')).toBeInTheDocument();
    expect(screen.getByText('首播 10月6日 · 00:30')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '新番一' })[0]).toHaveAttribute('href', 'https://bgm.tv/subject/501');
    expect(document.querySelector('.wishlist-cover img')).toHaveAttribute('referrerpolicy', 'no-referrer');

    await userEvent.click(screen.getByRole('button', { name: '加入想看' }));

    expect(screen.getAllByRole('button', { name: '已安排开季在看' })[0]).toBeDisabled();
    expect(onSyncStarted).not.toHaveBeenCalled();
    resolveAction(Response.json(runningSyncStatus(), { status: 202 }));
    await waitFor(() => expect(onSyncStarted).toHaveBeenCalledWith(expect.objectContaining({ state: 'running' })));
  });

  it('restores the action when adding the upcoming title fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === '/api/upcoming-season') return Response.json(upcomingData());
      if (input.toString() === '/api/upcoming-season/501/wishlist' && init?.method === 'POST') {
        return Response.json({ error: 'Bangumi write failed' }, { status: 502 });
      }
      throw new Error(`Unexpected request ${input.toString()}`);
    }));
    const onError = vi.fn();

    render(<UpcomingSeasonView disabled={false} refreshVersion={0} onSyncStarted={vi.fn()} onError={onError} />);
    await userEvent.click(await screen.findByRole('button', { name: '加入想看' }));

    expect(await screen.findByRole('button', { name: '加入想看' })).toBeEnabled();
    expect(onError).toHaveBeenCalledWith('Bangumi write failed');
  });

  it('does not let an older list request overwrite an optimistic schedule', async () => {
    let listRequests = 0;
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input.toString() === '/api/upcoming-season') {
        listRequests += 1;
        return listRequests === 1 ? Response.json(upcomingData()) : refreshResponse;
      }
      if (input.toString() === '/api/upcoming-season/501/wishlist' && init?.method === 'POST') {
        return Response.json(runningSyncStatus(), { status: 202 });
      }
      throw new Error(`Unexpected request ${input.toString()}`);
    }));
    const props = { disabled: false, onSyncStarted: vi.fn(), onError: vi.fn() };
    const view = render(<UpcomingSeasonView {...props} refreshVersion={0} />);
    await screen.findByRole('button', { name: '加入想看' });
    view.rerender(<UpcomingSeasonView {...props} refreshVersion={1} />);
    await waitFor(() => expect(listRequests).toBe(2));

    await userEvent.click(screen.getByRole('button', { name: '加入想看' }));
    resolveRefresh(Response.json(upcomingData()));

    await waitFor(() => expect(screen.getAllByRole('button', { name: '已安排开季在看' })[0]).toBeDisabled());
  });

  it('shows a source warning when Yuc new-anime station is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ seasonKey: '2026Q4', available: false, items: [] })));

    render(<UpcomingSeasonView disabled={false} refreshVersion={0} onSyncStarted={vi.fn()} onError={vi.fn()} />);

    expect(await screen.findByText('Yuc 新番列表暂时不可用，请稍后重试。')).toBeInTheDocument();
  });
});

function upcomingData() {
  return {
    seasonKey: '2026Q4',
    available: true,
    items: [
      {
        id: 501,
        name: 'Upcoming One',
        nameCn: '新番一',
        image: 'https://img.example/501.jpg',
        url: 'https://bgm.tv/subject/501',
        seasonKey: '2026Q4',
        sourceType: '原创',
        normalPremiereDate: '2026-10-05',
        airTime: '22:00',
        airWeekday: 1,
        collectionType: null,
        action: 'add',
        actionLabel: '加入想看',
        autoWatch: false
      },
      {
        id: 502,
        name: 'Upcoming Two',
        nameCn: '新番二',
        image: null,
        url: 'https://bgm.tv/subject/502',
        seasonKey: '2026Q4',
        sourceType: '漫改',
        normalPremiereDate: '2026-10-06',
        airTime: '00:30',
        airWeekday: 2,
        collectionType: 1,
        action: null,
        actionLabel: '已安排开季在看',
        autoWatch: true
      }
    ]
  };
}

function runningSyncStatus() {
  return {
    state: 'running',
    startedAt: '2026-08-31T12:00:00.000Z',
    completedAt: null,
    error: null,
    processedSubjects: 0,
    totalSubjects: 0,
    result: null
  };
}

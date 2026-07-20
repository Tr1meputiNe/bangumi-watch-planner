// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BacklogView from '../../src/client/views/BacklogView.js';
import type { BacklogData, DashboardSubject, EpisodeRow } from '../../src/server/types.js';

describe('BacklogView', () => {
  it('renders the seven-day plan and all backlog states', () => {
    render(<BacklogView data={backlogData()} disabled={false} onChanged={vi.fn()} onError={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '补番计划' })).toBeInTheDocument();
    expect(screen.getByLabelText('补番概览')).toHaveTextContent('进行中1 部');
    expect(document.querySelector('.backlog-overview-covers')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今日任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('今日任务')).toHaveTextContent('安排 1 集');
    expect(screen.getByRole('heading', { name: '未来 7 天' })).toBeInTheDocument();
    expect(screen.getByText('新番 5 集 · 可补 0 集')).toBeInTheDocument();
    expect(screen.getByText('预计完成 2026-08-01')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '进行中' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '搁置' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '已完成' })).toBeInTheDocument();
    expect(screen.getByText('1 / ?')).toBeInTheDocument();
  });

  it('renders watching-style progress cards and updates backlog episode progress', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn(async () => undefined);
    const data = backlogData();
    data.active[0] = subject({
      id: 101,
      nameCn: '进行中的旧番',
      image: 'https://example.test/active.jpg',
      mainEpisodes: [episode({ id: 10, ep: 1, sort: 1, collectionType: 2 }), episode()],
      unwatchedMainEpisodes: [episode()],
      unwatchedMainEpisodeCount: 1
    });
    render(<BacklogView data={data} disabled={false} onChanged={onChanged} onError={vi.fn()} />);

    for (const title of ['进行中的旧番', '搁置的旧番', '完成的旧番']) {
      expect(screen.getByLabelText(`${title}集数进度`)).toBeInTheDocument();
    }
    const activeSection = screen.getByLabelText('进行中');
    expect(within(activeSection).getAllByRole('link', { name: '进行中的旧番' })[0]).toHaveClass('subject-cover');
    expect(screen.getByLabelText('旧番 第 2 集')).toHaveClass('backlog-task-cover');
    expect(within(activeSection).getByText('1 / 12')).toBeInTheDocument();
    expect(within(activeSection).getByText('1 集未看')).toBeInTheDocument();
    expect(within(activeSection).getByText('下一集：第 2 集 · 播出时间：2020-01-08 20:00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '进行中的旧番 第 1 集 取消看过' }));
    await userEvent.click(screen.getByRole('button', { name: '进行中的旧番 第 2 集 标为看过' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith('/api/episodes/10/unwatched', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledWith('/api/subjects/101/watched-through', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ episodeId: 11 })
    });
  });

  it('sends every backlog action and refreshes after each success', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn(async () => undefined);
    render(<BacklogView data={backlogData()} disabled={false} onChanged={onChanged} onError={vi.fn()} />);

    for (const name of ['已看', '换一部', '今天跳过', '重新规划今天', '暂停', '恢复', '手动完成']) {
      await userEvent.click(screen.getByRole('button', { name }));
    }

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(7));
    expect(fetchMock.mock.calls.map(([input, init]) => [input.toString(), init?.method])).toEqual([
      ['/api/episodes/11/watched', 'POST'],
      ['/api/backlog/tasks/11/swap', 'POST'],
      ['/api/backlog/today/skip', 'POST'],
      ['/api/backlog/today/replan', 'POST'],
      ['/api/backlog/101/pause', 'POST'],
      ['/api/backlog/102/resume', 'POST'],
      ['/api/backlog/101/complete', 'POST']
    ]);
  });

  it('keeps a failed task visible and reports the server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '写入失败' }, { status: 500 })));
    const onChanged = vi.fn(async () => undefined);
    const onError = vi.fn();
    render(<BacklogView data={backlogData()} disabled={false} onChanged={onChanged} onError={onError} />);

    await userEvent.click(screen.getByRole('button', { name: '已看' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('写入失败'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText('旧番 第 2 集')).toBeInTheDocument();
  });
});

function backlogData(): BacklogData {
  const active = subject({ id: 101, nameCn: '进行中的旧番', eps: 0, totalEpisodesKnown: false });
  return {
    today: '2026-07-19',
    todayTasks: [{
      id: 1,
      episodeId: 11,
      subjectId: 101,
      plannedDate: '2026-07-19',
      slot: 0,
      locked: true,
      episode: episode()
    }],
    futureDays: [{ date: '2026-07-20', seasonalLoad: 5, capacity: 0, tasks: [] }],
    active: [active],
    held: [subject({ id: 102, nameCn: '搁置的旧番', collectionType: 4 })],
    completed: [subject({ id: 103, nameCn: '完成的旧番', collectionType: 2, completedAt: '2026-07-18' })],
    estimatedCompletionDate: '2026-08-01'
  };
}

function subject(overrides: Partial<DashboardSubject> = {}): DashboardSubject {
  return {
    id: 101,
    name: 'Old Anime',
    nameCn: '进行中的旧番',
    eps: 12,
    epStatus: 1,
    image: null,
    url: 'https://bgm.tv/subject/101',
    collectionType: 3,
    plannerMode: 'backlog',
    seasonKey: null,
    seasonKind: null,
    airYear: 2020,
    totalEpisodesKnown: true,
    completedAt: null,
    nextEpisode: episode(),
    mainEpisodes: [episode()],
    unwatchedMainEpisodeCount: 1,
    unwatchedMainEpisodes: [episode()],
    ...overrides
  };
}

function episode(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 11,
    subjectId: 101,
    subjectName: 'Old Anime',
    subjectNameCn: '旧番',
    subjectUrl: 'https://bgm.tv/subject/101',
    episodeType: 0,
    sort: 2,
    ep: 2,
    name: 'second',
    nameCn: '第 2 集',
    airdate: '2020-01-08',
    airTime: '20:00',
    collectionType: 0,
    dismissedAt: null,
    snoozedUntil: null,
    ...overrides
  };
}

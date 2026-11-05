// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BacklogView from '../../src/client/views/BacklogView.js';
import type { BacklogData, DashboardSubject, EpisodeRow } from '../../src/server/types.js';

describe('BacklogView', () => {
  it('shows a free library without schedules or invented recent watching', () => {
    renderView();
    expect(screen.getByRole('heading', { name: '补番' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '全部待补' })).toBeInTheDocument();
    expect(screen.getByLabelText('最近在看')).toHaveTextContent('暂无最近观看');
    expect(screen.queryByRole('heading', { name: '今日任务' })).not.toBeInTheDocument();
    expect(screen.queryByText(/预计完成|公平轮转|未来 7 天|今天跳过/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('进行中的旧番集数进度')).not.toBeInTheDocument();
    expect(screen.queryByText('搁置的旧番')).not.toBeInTheDocument();
  });

  it('uses only server-provided active recent records and limits them to six', () => {
    const data = backlogData();
    data.active = Array.from({ length: 8 }, (_, i) => subject({ id: 101 + i, nameCn: `最近番剧${i}` }));
    data.recent = [...data.active, subject({ id: 999, nameCn: '已经搁置', collectionType: 4 })];
    renderView(data);
    const recent = screen.getByLabelText('最近在看');
    expect(within(recent).getAllByRole('article')).toHaveLength(6);
    expect(within(recent).queryByText('已经搁置')).not.toBeInTheDocument();
    expect(within(recent).queryByText('最近番剧6')).not.toBeInTheDocument();
  });

  it('searches both original and translated names and clears an empty search', async () => {
    const data = backlogData();
    data.active.push(subject({ id: 102, name: 'Hibike Euphonium', nameCn: '吹响吧！上低音号' }));
    renderView(data);
    const library = screen.getByLabelText('全部待补');
    const input = screen.getByRole('searchbox', { name: '搜索补番' });
    await userEvent.type(input, 'hibike');
    expect(within(library).getByRole('article', { name: '吹响吧！上低音号' })).toBeInTheDocument();
    expect(within(library).queryByRole('article', { name: '进行中的旧番' })).not.toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '不存在');
    expect(within(library).getByText('没有找到符合条件的动画。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(within(library).getAllByRole('article')).toHaveLength(2);
  });

  it('sorts by remaining episodes with unknown totals last', async () => {
    const data = backlogData();
    data.active = [subject({ nameCn: '剩很多', eps: 24, epStatus: 1 }), subject({ id: 102, nameCn: '快看完', eps: 12, epStatus: 11 }), subject({ id: 103, nameCn: '总数未知', eps: 0, totalEpisodesKnown: false })];
    renderView(data);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '补番排序' }), 'remaining');
    expect(within(screen.getByLabelText('全部待补')).getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['快看完', '剩很多', '总数未知']);
  });

  it('only renders a manageable first page and supports showing more', async () => {
    const data = backlogData();
    data.active = Array.from({ length: 30 }, (_, i) => subject({ id: 101 + i, nameCn: `番剧${i}` }));
    renderView(data);
    const library = screen.getByLabelText('全部待补');
    expect(within(library).getAllByRole('article')).toHaveLength(24);
    await userEvent.click(screen.getByRole('button', { name: /再显示/ }));
    expect(within(library).getAllByRole('article')).toHaveLength(30);
  });

  it('records directly from the episode grid and refreshes without a separate record button', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn(async () => undefined);
    renderView(backlogData(), onChanged);
    await userEvent.click(screen.getByRole('button', { name: '展开集数' }));
    await userEvent.click(screen.getByRole('button', { name: '进行中的旧番 第 2 集 标为看过' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/subjects/101/watched-through', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ episodeId: 11 }) });
    expect(screen.getByRole('status')).toHaveTextContent('进度已更新');
  });

  it('expands progress on demand and preserves the original episode click behavior', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const data = backlogData();
    data.active[0] = subject({ progressEpisodes: [episode({ id: 10, ep: 1, sort: 1, collectionType: 2 }), episode()] });
    renderView(data);
    await userEvent.click(screen.getByRole('button', { name: '展开集数' }));
    expect(screen.queryByRole('button', { name: /记录第.*集看过/ })).not.toBeInTheDocument();
    const grid = screen.getByLabelText('进行中的旧番集数进度');
    await userEvent.click(within(grid).getByRole('button', { name: '进行中的旧番 第 2 集 标为看过' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/subjects/101/watched-through', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ episodeId: 11 }) }));
  });

  it('renders a cover gallery and expands progress inline after the selected card row', async () => {
    const data = backlogData();
    data.active = [1, 2, 3].map((i) => subject({ id: 100 + i, nameCn: `番剧${i}`, name: `Original ${i}`, image: `https://example.test/${i}.jpg` }));
    renderView(data);
    const library = screen.getByLabelText('全部待补');
    const first = within(library).getByRole('article', { name: '番剧1' });
    expect(within(first).getByRole('img')).toHaveAttribute('src', 'https://example.test/1.jpg');
    expect(first).toHaveTextContent('Original 1');
    const toggle = within(first).getByRole('button', { name: '展开集数' });
    await userEvent.click(toggle);
    const panel = screen.getByRole('region', { name: '番剧1观看进度' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
    const cells = Array.from(library.querySelector('.free-backlog-library')!.children);
    expect(cells.indexOf(panel)).toBe(2);
    expect(cells[3]).toHaveAttribute('aria-label', '番剧3');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('批量补记')).not.toBeInTheDocument();
  });

  it('switches inline progress between cards and collapses back to the trigger', async () => {
    const data = backlogData();
    data.active.push(subject({ id: 102, nameCn: '另一部动画' }));
    renderView(data);
    const library = screen.getByLabelText('全部待补');
    await userEvent.click(within(within(library).getByRole('article', { name: '进行中的旧番' })).getByRole('button', { name: '展开集数' }));
    const secondToggle = within(within(library).getByRole('article', { name: '另一部动画' })).getByRole('button', { name: '展开集数' });
    await userEvent.click(secondToggle);
    expect(screen.queryByRole('region', { name: '进行中的旧番观看进度' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '另一部动画观看进度' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '收起《另一部动画》的集数' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '另一部动画观看进度' })).not.toBeInTheDocument());
    expect(secondToggle).toHaveFocus();
    expect(secondToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('repositions the inline panel after the complete row when the container changes size', async () => {
    let onResize!: ResizeObserverCallback;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { onResize = callback; }
      observe() { /* The test drives actual container widths. */ }
      disconnect() { /* No retained observer in this test. */ }
    });
    const data = backlogData();
    data.active = [1, 2, 3, 4, 5].map((i) => subject({ id: 100 + i, nameCn: `番剧${i}` }));
    renderView(data);
    const library = screen.getByLabelText('全部待补');
    await userEvent.click(within(within(library).getByRole('article', { name: '番剧1' })).getByRole('button', { name: '展开集数' }));
    await act(async () => onResize([{ contentRect: { width: 1000 } } as ResizeObserverEntry], {} as ResizeObserver));
    const panel = screen.getByRole('region', { name: '番剧1观看进度' });
    expect(Array.from(library.querySelector('.free-backlog-library')!.children).indexOf(panel)).toBe(4);
    await act(async () => onResize([{ contentRect: { width: 700 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(Array.from(library.querySelector('.free-backlog-library')!.children).indexOf(screen.getByRole('region', { name: '番剧1观看进度' }))).toBe(3);
  });

  it('closes filtered-out progress and does not unexpectedly reopen it after clearing search', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: '展开集数' }));
    const search = screen.getByRole('searchbox', { name: '搜索补番' });
    await userEvent.type(search, '不存在');
    expect(screen.queryByRole('region', { name: '进行中的旧番观看进度' })).not.toBeInTheDocument();
    await userEvent.clear(search);
    expect(screen.getByRole('button', { name: '展开集数' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not pick candidates until asked and avoids repeats within a round', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const data = backlogData();
    data.active = Array.from({ length: 7 }, (_, i) => subject({ id: 101 + i, nameCn: `候选番剧${i}` }));
    renderView(data);
    expect(screen.queryByLabelText('这次的候选')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '帮我挑一部' }));
    const first = within(screen.getByLabelText('这次的候选')).getAllByRole('article').map((card) => card.getAttribute('aria-label'));
    expect(first).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: '换一批' }));
    const second = within(screen.getByLabelText('这次的候选')).getAllByRole('article').map((card) => card.getAttribute('aria-label'));
    expect(second).toHaveLength(3);
    expect(second.filter((name) => first.includes(name))).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers a different choice when only two candidates are available', async () => {
    const data = backlogData();
    data.active.push(subject({ id: 102, nameCn: '另一部动画' }));
    renderView(data);
    await userEvent.click(screen.getByRole('button', { name: '帮我挑一部' }));
    const first = within(screen.getByLabelText('这次的候选')).getByRole('article').getAttribute('aria-label');
    await userEvent.click(screen.getByRole('button', { name: '换一批' }));
    expect(within(screen.getByLabelText('这次的候选')).getByRole('article').getAttribute('aria-label')).not.toBe(first);
  });

  it('sorts recent viewing by the recorded watch time instead of progress', async () => {
    const data = backlogData();
    data.active = [subject({ nameCn: '看得更多', epStatus: 10, lastWatchedAt: '2026-07-18T12:00:00.000Z' }), subject({ id: 102, nameCn: '刚看一集', epStatus: 1, lastWatchedAt: '2026-07-19T12:00:00.000Z' }), subject({ id: 103, nameCn: '还没看过', epStatus: 11 })];
    renderView(data);
    expect(within(screen.getByLabelText('全部待补')).getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['刚看一集', '看得更多', '还没看过']);
  });

  it('handles one eligible candidate and an empty library', async () => {
    const { unmount } = renderView();
    await userEvent.click(screen.getByRole('button', { name: '帮我挑一部' }));
    expect(within(screen.getByLabelText('这次的候选')).getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '换一批' })).toBeDisabled();
    unmount();
    const data = backlogData();
    data.active = [];
    renderView(data);
    expect(screen.getByLabelText('全部待补')).toHaveTextContent('还没有待补的动画');
    expect(screen.getByRole('button', { name: '帮我挑一部' })).toBeDisabled();
  });

  it('keeps failed actions visible and unlocks controls for retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '写入失败' }, { status: 500 })));
    const onError = vi.fn();
    const onChanged = vi.fn(async () => undefined);
    render(<BacklogView data={backlogData()} disabled={false} onChanged={onChanged} onError={onError} />);
    await userEvent.click(screen.getByRole('button', { name: '展开集数' }));
    await userEvent.click(screen.getByRole('button', { name: '进行中的旧番 第 2 集 标为看过' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('写入失败'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '进行中的旧番 第 2 集 标为看过' })).toBeEnabled();
    expect(screen.getByRole('article', { name: '进行中的旧番' })).toBeInTheDocument();
  });

  it('locks conflicting writes until the current request and refresh finish', async () => {
    let resolveWrite!: (response: Response) => void;
    const fetchMock = vi.fn(async () => new Promise<Response>((resolve) => { resolveWrite = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    renderView();
    await userEvent.click(screen.getByRole('button', { name: '展开集数' }));
    await userEvent.dblClick(screen.getByRole('button', { name: '进行中的旧番 第 2 集 标为看过' }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '搁置《进行中的旧番》' })).toBeDisabled();
    await act(async () => resolveWrite(new Response(null, { status: 204 })));
    await waitFor(() => expect(screen.getByRole('button', { name: '搁置《进行中的旧番》' })).toBeEnabled());
  });

  it('supports holding and manually completing unknown-total subjects', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const data = backlogData();
    data.active[0] = subject({ eps: 0, totalEpisodesKnown: false });
    renderView(data);
    await userEvent.click(screen.getByRole('button', { name: '展开集数' }));
    await userEvent.click(screen.getByRole('button', { name: '手动完成' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/backlog/101/complete', { method: 'POST' }));
    await userEvent.click(screen.getByRole('button', { name: '搁置《进行中的旧番》' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/backlog/101/pause', { method: 'POST' }));
  });
});

function renderView(data = backlogData(), onChanged = vi.fn(async () => undefined)) {
  return render(<BacklogView data={data} disabled={false} onChanged={onChanged} onError={vi.fn()} />);
}

function backlogData(): BacklogData {
  return {
    today: '2026-07-19', todayTasks: [], futureDays: [], estimatedCompletionDate: null,
    active: [subject()], held: [subject({ id: 102, nameCn: '搁置的旧番', collectionType: 4 })],
    completed: [], recent: []
  };
}

function subject(overrides: Partial<DashboardSubject> = {}): DashboardSubject {
  const episodes = [episode()];
  return {
    id: 101, name: 'Old Anime', nameCn: '进行中的旧番', eps: 12, epStatus: 1,
    image: null, url: 'https://bgm.tv/subject/101', collectionType: 3, plannerMode: 'backlog',
    seasonKey: null, seasonKind: null, airYear: 2020, totalEpisodesKnown: true, completedAt: null,
    nextEpisode: episode(), mainEpisodes: episodes, progressEpisodes: episodes,
    unwatchedMainEpisodeCount: 1, unwatchedProgressEpisodeCount: 1, unwatchedMainEpisodes: episodes,
    ...overrides
  };
}

function episode(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 11, subjectId: 101, subjectName: 'Old Anime', subjectNameCn: '旧番',
    subjectUrl: 'https://bgm.tv/subject/101', episodeType: 0, sort: 2, ep: 2,
    name: 'second', nameCn: '第 2 集', airdate: '2020-01-08', airTime: '20:00',
    collectionType: 0, dismissedAt: null, snoozedUntil: null, ...overrides
  };
}

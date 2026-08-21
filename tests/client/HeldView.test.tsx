// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HeldView from '../../src/client/views/HeldView.js';
import type { DashboardSubject } from '../../src/server/types.js';

describe('HeldView', () => {
  it('shows both origins and restores a title through the unified endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn(async () => undefined);
    render(
      <HeldView
        subjects={[subject(1, '季番', 'seasonal'), subject(2, '旧番', 'backlog')]}
        disabled={false}
        onChanged={onChanged}
        onError={vi.fn()}
      />
    );

    expect(screen.getByLabelText('搁置概览')).toHaveTextContent('本季追番1 部');
    expect(within(screen.getByLabelText('已搁置动画')).getAllByText('补番')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: '恢复在看' })[0]);

    expect(screen.queryByText('季番')).not.toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/subjects/1/resume', { method: 'POST' });
  });

  it('rolls an optimistic removal back when Bangumi rejects it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '写入失败' }, { status: 502 })));
    const onError = vi.fn();
    render(
      <HeldView
        subjects={[subject(2, '旧番', 'backlog')]}
        disabled={false}
        onChanged={vi.fn()}
        onError={onError}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '恢复在看' }));
    expect(screen.queryByText('旧番')).not.toBeInTheDocument();

    await waitFor(() => expect(onError).toHaveBeenCalledWith('写入失败'));
    expect(screen.getAllByText('旧番').length).toBeGreaterThan(0);
  });
});

function subject(id: number, nameCn: string, plannerMode: 'seasonal' | 'backlog'): DashboardSubject {
  return {
    id,
    name: `Subject ${id}`,
    nameCn,
    eps: 12,
    epStatus: 3,
    image: null,
    url: `https://bgm.tv/subject/${id}`,
    collectionType: 4,
    plannerMode,
    seasonKey: plannerMode === 'seasonal' ? '2026Q3' : null,
    seasonKind: plannerMode === 'seasonal' ? 'new' : null,
    airDate: '2024-01-01',
    airYear: 2024,
    totalEpisodesKnown: true,
    completedAt: null,
    nextEpisode: null,
    mainEpisodes: [],
    unwatchedMainEpisodeCount: 9,
    unwatchedMainEpisodes: []
  };
}

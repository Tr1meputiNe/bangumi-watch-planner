// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import WatchProgressGrid from '../../src/client/WatchProgressGrid.js';
import type { EpisodeRow } from '../../src/server/types.js';

function episode(id: number, sort: number, overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return { id, subjectId: 1, subjectName: 'Anime', subjectNameCn: '测试', subjectUrl: 'https://bgm.tv/subject/1', episodeType: 0, sort, ep: sort, name: '', nameCn: '', airdate: '2020-01-01', airTime: '', collectionType: 0, dismissedAt: null, snoozedUntil: null, ...overrides };
}

function renderGrid(episodes: EpisodeRow[], totalEpisodes = 3, disabled = false) {
  const props = { subjectTitle: '测试', episodes, totalEpisodes, disabled, motionKey: 'test', onWatched: vi.fn(), onUnwatched: vi.fn(), onWatchedThrough: vi.fn() };
  return { ...render(<WatchProgressGrid {...props} />), ...props };
}

describe('WatchProgressGrid', () => {
  it('preserves clicking an unwatched main episode to mark watched through it', async () => {
    const callbacks = renderGrid([episode(1, 1), episode(2, 2), episode(3, 3)]);
    await userEvent.click(screen.getByRole('button', { name: '测试 第 3 集 标为看过' }));
    expect(callbacks.onWatchedThrough).toHaveBeenCalledExactlyOnceWith(3);
    expect(callbacks.onWatched).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('批量补记')).not.toBeInTheDocument();
  });

  it('keeps an unwatched special episode as a single-episode action', async () => {
    const callbacks = renderGrid([episode(1, 1), episode(12, 1.5, { episodeType: 1 })]);
    await userEvent.click(screen.getByRole('button', { name: '测试 特别篇 第 1.5 集 标为看过' }));
    expect(callbacks.onWatched).toHaveBeenCalledExactlyOnceWith(12);
    expect(callbacks.onWatchedThrough).not.toHaveBeenCalled();
  });

  it('preserves fractional, trailing, and colliding special episodes', () => {
    renderGrid([episode(1, 1), episode(2, 2), episode(3, 3), episode(12, 1.5, { episodeType: 1 }), episode(14, 14, { episodeType: 1 }), episode(22, 2, { episodeType: 1, ep: 0 })]);
    const grid = screen.getByLabelText('测试集数进度');
    expect(within(grid).getAllByRole('button')).toHaveLength(6);
    expect(within(grid).getByRole('button', { name: '测试 特别篇 第 1.5 集 标为看过' })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: '测试 特别篇 第 14 集 标为看过' })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: '测试 第 2 集 标为看过' })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: '测试 特别篇 第 2 集 标为看过' })).toBeInTheDocument();
  });

  it('keeps missing declared episodes disabled and permits undoing a watched episode', async () => {
    const callbacks = renderGrid([episode(1, 1, { collectionType: 2 })]);
    expect(screen.getByRole('button', { name: '测试 第 2 集 尚未同步' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '测试 第 1 集 取消看过' }));
    expect(callbacks.onUnwatched).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('disables main and special episode actions while saving', async () => {
    const callbacks = renderGrid([episode(1, 1), episode(2, 2, { episodeType: 1 })], 2, true);
    const main = screen.getByRole('button', { name: '测试 第 1 集 标为看过' });
    const special = screen.getByRole('button', { name: '测试 特别篇 第 2 集 标为看过' });
    expect(main).toBeDisabled();
    expect(special).toBeDisabled();
    await userEvent.click(main);
    await userEvent.click(special);
    expect(callbacks.onWatched).not.toHaveBeenCalled();
    expect(callbacks.onWatchedThrough).not.toHaveBeenCalled();
  });
});

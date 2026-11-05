// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CalendarView from '../../src/client/views/CalendarView.js';
import type { CalendarDay } from '../../src/server/types.js';

describe('CalendarView', () => {
  it('discards canceled correction values before reopening the editor', async () => {
    render(<CalendarView state={{ days: days(), loading: false, error: null }} onRetry={vi.fn()} onError={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '校正时间' }));
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-11-07' } });
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '23:00' } });
    await userEvent.click(screen.getByRole('button', { name: '取消校正' }));
    await userEvent.click(screen.getByRole('button', { name: '校正时间' }));

    expect(screen.getByLabelText('日期')).toHaveValue('2026-11-05');
    expect(screen.getByLabelText('时间')).toHaveValue('21:00');
  });

  it('locks the entire correction while saving and retains the draft after a failure', async () => {
    let resolveSave!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveSave = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();
    render(<CalendarView state={{ days: days(), loading: false, error: null }} onRetry={vi.fn()} onError={onError} />);
    await userEvent.click(screen.getByRole('button', { name: '校正时间' }));
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '23:00' } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByLabelText('日期')).toBeDisabled();
    expect(screen.getByLabelText('时间')).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消校正' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled();
    resolveSave(Response.json({ error: '校正失败' }, { status: 502 }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('校正失败'));
    expect(screen.getByLabelText('时间')).toHaveValue('23:00');
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('shows a useful empty state inside a weekday with no broadcasts', () => {
    render(<CalendarView state={{ days: [{ weekday: { id: 1, cn: '星期一', en: 'Mon', ja: '月' }, items: [] }], loading: false, error: null }} onRetry={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText('暂无放送')).toBeInTheDocument();
  });
});

function days(): CalendarDay[] {
  return [{
    weekday: { id: 4, cn: '星期四', en: 'Thu', ja: '木' },
    items: [{
      id: 123, name: 'Calendar anime', nameCn: '测试放送', url: 'https://bgm.tv/subject/123',
      image: null, airDate: '2026-11-05', airTime: '21:00', airWeekday: 4,
      ratingScore: null, rank: null, collectionDoing: null
    }]
  }];
}

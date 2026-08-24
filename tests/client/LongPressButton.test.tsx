// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LongPressButton from '../../src/client/LongPressButton.js';

afterEach(() => vi.useRealTimers());

describe('LongPressButton', () => {
  it('commits only after a continuous 1500ms press', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<LongPressButton subjectTitle="测试番剧" onCommit={onCommit} />);
    const button = screen.getByRole('button', { name: '长按 1.5 秒抛弃 测试番剧' });
    button.setPointerCapture = vi.fn();

    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    expect(button).toHaveClass('is-pressing');
    expect(button.querySelector('.long-press-progress')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_499));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledOnce();
    expect(button).not.toHaveClass('is-pressing');
  });

  it('cancels on release, exit, scroll, and supports keyboard hold', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<LongPressButton subjectTitle="测试番剧" onCommit={onCommit} />);
    const button = screen.getByRole('button', { name: '长按 1.5 秒抛弃 测试番剧' });
    button.setPointerCapture = vi.fn();

    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(button, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(1_500));
    fireEvent.pointerDown(button, { button: 0, pointerId: 2 });
    fireEvent.pointerLeave(button, { pointerId: 2 });
    act(() => vi.advanceTimersByTime(1_500));
    fireEvent.pointerDown(button, { button: 0, pointerId: 3 });
    fireEvent.scroll(window);
    act(() => vi.advanceTimersByTime(1_500));
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(button, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(1_500));
    expect(onCommit).toHaveBeenCalledOnce();
  });
});

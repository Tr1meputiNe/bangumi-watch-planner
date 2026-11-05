// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CoverImage from '../../src/client/CoverImage.js';

const source = 'https://lain.bgm.tv/r/400/pic/cover/l/63/4e/357961_RtPiz.jpg';
const original = 'https://lain.bgm.tv/pic/cover/l/63/4e/357961_RtPiz.jpg';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('CoverImage recovery', () => {
  it('uses the same-origin cached endpoint for Bangumi covers', () => {
    render(<CoverImage src={source} alt="封面" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', `/api/images/cover?url=${encodeURIComponent(source)}`);
    expect(screen.getByRole('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to the original CDN path and stops after a successful load', () => {
    vi.useFakeTimers();
    render(<CoverImage src={source} alt="封面" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('src', original);
    fireEvent.load(screen.getByRole('img'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('img')).toHaveAttribute('src', original);
  });

  it('recovers stalled requests, gives a stable fallback, and retries when the network returns', () => {
    vi.useFakeTimers();
    render(<CoverImage src={source} alt="封面" fallback="暂无封面" />);
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('img')).toHaveAttribute('src', original);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('暂无封面')).toBeInTheDocument();
    expect(screen.getByRole('img')).not.toHaveAttribute('src');
    fireEvent(window, new Event('online'));
    expect(screen.getByRole('img')).toHaveAttribute('src', `/api/images/cover?url=${encodeURIComponent(source)}`);
  });

  it('does not time out lazy images before they approach the viewport', () => {
    vi.useFakeTimers();
    let intersect!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    render(<CoverImage src={source} alt="封面" />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('img')).toHaveAttribute('src', `/api/images/cover?url=${encodeURIComponent(source)}`);
    act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('img')).toHaveAttribute('src', original);
    expect(disconnect).toHaveBeenCalled();
  });

  it('resets recovery for a changed source and does not keep the previous failure', () => {
    const { rerender } = render(<CoverImage src={source} alt="封面" fallback="暂无封面" />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('暂无封面')).toBeInTheDocument();
    const next = source.replace('357961_RtPiz', '49278_mo7EP');
    rerender(<CoverImage src={next} alt="封面" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', `/api/images/cover?url=${encodeURIComponent(next)}`);
  });

  it('shows a placeholder immediately for missing covers and does not proxy other hosts', () => {
    const { rerender } = render(<CoverImage src={null} fallback="暂无封面" />);
    expect(screen.getByText('暂无封面')).toBeInTheDocument();
    rerender(<CoverImage src="https://example.com/cover.jpg" alt="封面" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/cover.jpg');
  });
});
